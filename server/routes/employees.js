// server/routes/employees.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { buildEmployeeSearch } = require('../utils/employeeSearch');
const { requireRole } = require('../middleware/auth');
const {
  PHONE_BOOK_URL,
  MIN_SYNC_EMPLOYEES,
  normalizeValue,
  createEmployeeIdentity,
  fetchAllPhoneBookEmployees,
  assertDirectorySnapshot
} = require('../utils/employeeDirectory');

const SYNC_CHANGE_PREVIEW_LIMIT = Number(process.env.EMPLOYEE_SYNC_CHANGE_PREVIEW_LIMIT || 1000);

let phoneBookSchemaPromise;
const preparePhoneBookSchema = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS phone_book (
      id INT AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(255) NULL,
      full_name VARCHAR(255) NOT NULL,
      position VARCHAR(255) NULL,
      department VARCHAR(255) NULL,
      room VARCHAR(100) NULL,
      internal_phone VARCHAR(100) NULL,
      external_phone VARCHAR(100) NULL,
      email VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_seen_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [columns] = await pool.execute('SHOW COLUMNS FROM phone_book');
  const existing = new Set((columns || []).map((column) => column.Field));
  const alters = [
    ['source_key', 'ALTER TABLE phone_book ADD COLUMN source_key VARCHAR(255) NULL'],
    ['is_active', 'ALTER TABLE phone_book ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1'],
    ['last_seen_at', 'ALTER TABLE phone_book ADD COLUMN last_seen_at DATETIME NULL'],
    ['external_phone', 'ALTER TABLE phone_book ADD COLUMN external_phone VARCHAR(100) NULL AFTER internal_phone'],
    ['updated_at', 'ALTER TABLE phone_book ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
    ['created_at', 'ALTER TABLE phone_book ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP']
  ];

  for (const [column, sql] of alters) {
    if (!existing.has(column)) await pool.execute(sql);
  }

  await pool.execute(`
    UPDATE phone_book
    SET source_key = LOWER(TRIM(CONCAT_WS('|', NULLIF(email, ''), full_name, COALESCE(department, ''), COALESCE(room, ''), COALESCE(internal_phone, ''), COALESCE(external_phone, ''))))
    WHERE source_key IS NULL OR source_key = ''
  `);

  const indexStatements = [
    'CREATE UNIQUE INDEX uniq_phone_book_source_key ON phone_book (source_key)',
    'CREATE INDEX idx_phone_book_full_name ON phone_book (full_name)',
    'CREATE INDEX idx_phone_book_department ON phone_book (department)',
    'CREATE INDEX idx_phone_book_phone ON phone_book (internal_phone)',
    'CREATE INDEX idx_phone_book_external_phone ON phone_book (external_phone)',
    'CREATE INDEX idx_phone_book_email ON phone_book (email)',
    'CREATE INDEX idx_phone_book_is_active ON phone_book (is_active)'
  ];

  for (const sql of indexStatements) {
    try {
      await pool.execute(sql);
    } catch (error) {
      if (error.code !== 'ER_DUP_KEYNAME' && error.code !== 'ER_DUP_ENTRY') throw error;
    }
  }
};


const ensurePhoneBookSchema = () => {
  if (!phoneBookSchemaPromise) phoneBookSchemaPromise = preparePhoneBookSchema().catch((error) => { phoneBookSchemaPromise = null; throw error; });
  return phoneBookSchemaPromise;
};

const EMPLOYEE_SYNC_FIELDS = [
  ['full_name', 'ФИО'],
  ['position', 'Должность'],
  ['department', 'Отдел'],
  ['room', 'Кабинет'],
  ['internal_phone', 'Телефон вн.'],
  ['external_phone', 'Телефон внешний'],
  ['email', 'Email']
];

const serializeEmployee = (employee = {}) => ({
  source_key: employee.source_key || '',
  full_name: employee.full_name || '',
  position: employee.position || '',
  department: employee.department || '',
  room: employee.room || '',
  internal_phone: employee.internal_phone || '',
  external_phone: employee.external_phone || '',
  email: employee.email || ''
});

const getEmployeeChanges = (before = {}, after = {}) => EMPLOYEE_SYNC_FIELDS.reduce((changes, [field, label]) => {
  const oldValue = normalizeValue(before[field] || '');
  const newValue = normalizeValue(after[field] || '');
  if (oldValue !== newValue) changes.push({ field, label, oldValue, newValue });
  return changes;
}, []);

const createChangeSummary = (items) => ({
  count: items.length,
  items: items.slice(0, SYNC_CHANGE_PREVIEW_LIMIT)
});

const syncEmployees = async (employees) => {
  const connection = await pool.getConnection();
  const now = new Date();
  const insertedItems = [];
  const updatedItems = [];
  const deactivatedItems = [];
  let previousActive = 0;
  let activeAfter = 0;

  try {
    await connection.beginTransaction();

    const [activeRows] = await connection.execute('SELECT * FROM phone_book WHERE is_active = 1');
    previousActive = activeRows.length;
    // Неполный снимок источника нельзя применять: иначе отсутствующие в нём
    // сотрудники будут помечены уволенными, а их аккаунты удалены.
    assertDirectorySnapshot({ incomingCount: employees.length, currentActiveCount: previousActive });
    const activeBySourceKey = new Map();
    const activeByIdentity = new Map();

    for (const row of activeRows) {
      const serialized = serializeEmployee(row);
      if (serialized.source_key) activeBySourceKey.set(serialized.source_key, serialized);
      const identity = createEmployeeIdentity(serialized);
      if (identity && !activeByIdentity.has(identity)) activeByIdentity.set(identity, serialized);
    }

    await connection.execute('UPDATE phone_book SET is_active = 0 WHERE is_active = 1');
    const seenActiveSourceKeys = new Set();

    for (const parsedEmployee of employees) {
      const identity = createEmployeeIdentity(parsedEmployee);
      const existingEmployee = activeBySourceKey.get(parsedEmployee.source_key) || activeByIdentity.get(identity) || null;
      const dbSourceKey = existingEmployee?.source_key || parsedEmployee.source_key;
      const employee = { ...parsedEmployee, source_key: dbSourceKey };
      const changes = existingEmployee ? getEmployeeChanges(existingEmployee, employee) : [];

      if (existingEmployee) seenActiveSourceKeys.add(existingEmployee.source_key);

      await connection.execute(
        `INSERT INTO phone_book
          (source_key, full_name, position, department, room, internal_phone, external_phone, email, is_active, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
          full_name = VALUES(full_name),
          position = VALUES(position),
          department = VALUES(department),
          room = VALUES(room),
          internal_phone = VALUES(internal_phone),
          external_phone = VALUES(external_phone),
          email = VALUES(email),
          is_active = 1,
          last_seen_at = VALUES(last_seen_at)`,
        [
          employee.source_key,
          employee.full_name,
          employee.position || null,
          employee.department || null,
          employee.room || null,
          employee.internal_phone || null,
          employee.external_phone || null,
          employee.email || null,
          now
        ]
      );

      if (!existingEmployee) {
        insertedItems.push(serializeEmployee(employee));
      } else if (changes.length > 0) {
        updatedItems.push({ before: existingEmployee, after: serializeEmployee(employee), changes });
      }
    }

    for (const row of activeRows) {
      const serialized = serializeEmployee(row);
      if (!seenActiveSourceKeys.has(serialized.source_key)) deactivatedItems.push(serialized);
    }

    const [activeAfterRows] = await connection.execute('SELECT COUNT(*) AS count FROM phone_book WHERE is_active = 1');
    activeAfter = Number(activeAfterRows?.[0]?.count || 0);

    await connection.commit();
    return {
      inserted: insertedItems.length,
      updated: updatedItems.length,
      deactivated: deactivatedItems.length,
      previousActive,
      activeAfter,
      updatedAt: now.toISOString(),
      changes: {
        inserted: createChangeSummary(insertedItems),
        updated: createChangeSummary(updatedItems),
        deactivated: createChangeSummary(deactivatedItems)
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const ensurePhoneBookData = async () => {
  await ensurePhoneBookSchema();
  const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM phone_book WHERE is_active = 1');
  const total = Number(rows?.[0]?.total || 0);
  if (total > 0) return { total, synced: false };

  const { employees, pages, expectedPages, lastStart, sweeps, stable, failedStarts } = await fetchAllPhoneBookEmployees();
  if (failedStarts.length) {
    const error = new Error(`Не удалось загрузить страницы справочника: ${failedStarts.map((item) => item.start).join(', ')}`);
    error.status = 503;
    throw error;
  }
  if (employees.length < MIN_SYNC_EMPLOYEES) {
    const error = new Error(`Из справочника получено слишком мало записей: ${employees.length}`);
    error.status = 503;
    throw error;
  }

  const stats = await syncEmployees(employees);
  return { total: stats.activeAfter, synced: true, pages, expectedPages, lastStart, sweeps, stable };
};

// Полный справочник для служебных экранов администратора. Неактивные записи
// тоже возвращаются: они нужны, чтобы дополнить старые заявки сотрудников,
// которые уже уволены и отсутствуют в текущем активном списке.
// Внешний источник здесь намеренно не вызывается: карточки заявок всегда
// читают уже сохранённую локальную копию, обновляемую только из /settings.
router.get('/all', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await ensurePhoneBookSchema();
    const [employees] = await pool.execute(`
      SELECT id, source_key, full_name, position, department, room,
        internal_phone, external_phone, email, is_active, updated_at
      FROM phone_book
      WHERE full_name IS NOT NULL AND TRIM(full_name) <> ''
      ORDER BY is_active DESC, full_name ASC, updated_at DESC
    `);
    res.set('Cache-Control', 'no-store');
    res.json({ employees });
  } catch (error) {
    console.error('Employee directory list error:', error);
    res.status(500).json({ error: 'Не удалось получить справочник сотрудников' });
  }
});

// Поиск сотрудников
router.get('/search', async (req, res) => {
  try {
    await ensurePhoneBookSchema();

    const search = buildEmployeeSearch(req.query);
    if (search.error) return res.status(400).json({ error: search.error });
    const [results] = await pool.execute(search.sql, search.params);

    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Ошибка при поиске сотрудников' });
  }
});

// Получение всех отделов
router.get('/departments', async (req, res) => {
  try {
    await ensurePhoneBookSchema();

    const sql = `SELECT DISTINCT department FROM phone_book WHERE is_active = 1 AND department IS NOT NULL ORDER BY department`;
    const [results] = await pool.execute(sql);

    const departments = results.map(row => row.department);
    res.json(departments);
  } catch (error) {
    console.error('Departments error:', error);
    res.status(500).json({ error: 'Ошибка при получении отделов' });
  }
});

// Ручное обновление справочника сотрудников из внешнего телефонного справочника
router.post('/sync', requireRole('admin'), async (req, res) => {
  try {
    await ensurePhoneBookSchema();

    const snapshot = await fetchAllPhoneBookEmployees();
    const { employees, pages, expectedPages, lastStart, sweeps, stable, failedStarts } = snapshot;

    if (failedStarts.length) {
      return res.status(503).json({
        error: `Не удалось загрузить страницы справочника: ${failedStarts.map((item) => item.start).join(', ')}. Обновление отменено, данные не изменялись.`,
        sourceUrl: PHONE_BOOK_URL,
        pages,
        expectedPages,
        lastStart,
        failedStarts
      });
    }

    if (employees.length < MIN_SYNC_EMPLOYEES) {
      return res.status(422).json({
        error: `Из источника получено слишком мало записей: ${employees.length}. Проверьте формат страницы или доступ к справочнику.`,
        parsed: employees.length,
        sourceUrl: PHONE_BOOK_URL,
        pages,
        expectedPages,
        lastStart
      });
    }

    const stats = await syncEmployees(employees);

    res.json({
      message: 'Справочник сотрудников обновлён',
      sourceUrl: PHONE_BOOK_URL,
      parsed: employees.length,
      pages,
      expectedPages,
      lastStart,
      sweeps,
      stable,
      ...stats
    });
  } catch (error) {
    console.error('Employee sync error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'Ошибка обновления справочника сотрудников',
      parsed: error.parsed,
      activeBefore: error.activeBefore
    });
  }
});

router.ensurePhoneBookData = ensurePhoneBookData;
module.exports = router;
