// server/routes/employees.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { buildEmployeeSearch } = require('../utils/employeeSearch');
const { requireRole } = require('../middleware/auth');
const { PHONE_BOOK_URL, fetchAllPhoneBookEmployees } = require('../utils/employeeDirectory');
const { synchronizeDirectory } = require('../utils/employeeDirectorySync');

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

  await pool.execute(`CREATE TABLE IF NOT EXISTS phone_book_sync_state (
    id TINYINT PRIMARY KEY,
    version INT NOT NULL
  )`);

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

const refreshDirectory = () => synchronizeDirectory({
  pool,
  fetchSnapshot: fetchAllPhoneBookEmployees,
  previewLimit: SYNC_CHANGE_PREVIEW_LIMIT
});

const ensurePhoneBookData = async () => {
  await ensurePhoneBookSchema();
  const [rows] = await pool.execute('SELECT COUNT(*) AS total FROM phone_book WHERE is_active = 1');
  const total = Number(rows?.[0]?.total || 0);
  if (total > 0) return { total, synced: false };
  const stats = await refreshDirectory();
  return { ...stats, total: stats.activeAfter, synced: true };
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

    const stats = await refreshDirectory();
    res.json({ message: 'Справочник сотрудников обновлён', sourceUrl: PHONE_BOOK_URL, ...stats });
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
