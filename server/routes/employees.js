// server/routes/employees.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requireRole } = require('../middleware/auth');

const PHONE_BOOK_URL = process.env.PHONE_BOOK_URL || 'http://web3.nioch.nsc.ru/nioch/index.php/ru/kontakty/telefonnyj-spravochnik';
const MIN_SYNC_EMPLOYEES = Number(process.env.EMPLOYEE_SYNC_MIN_ROWS || 50);
const PHONE_BOOK_PAGE_SIZE = Number(process.env.PHONE_BOOK_PAGE_SIZE || 20);
const PHONE_BOOK_MAX_PAGES = Number(process.env.PHONE_BOOK_MAX_PAGES || 25);
const SYNC_CHANGE_PREVIEW_LIMIT = Number(process.env.EMPLOYEE_SYNC_CHANGE_PREVIEW_LIMIT || 5);

const decodeHtmlEntities = (value = '') => String(value)
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const cleanText = (value = '') => decodeHtmlEntities(String(value)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const normalizeValue = (value = '') => cleanText(value).replace(/^[-–—]+$/, '').trim();

const normalizeSourceKeyPart = (value = '') => normalizeValue(value).toLowerCase().replace(/\s+/g, ' ');

const createEmployeeIdentity = (employee) => [
  employee.full_name || '',
  employee.department || ''
].map(normalizeSourceKeyPart).filter(Boolean).join('|');

const createSourceKey = (employee) => createEmployeeIdentity(employee) || [
  employee.full_name || '',
  employee.room || '',
  employee.internal_phone || '',
  employee.email || ''
].map(normalizeSourceKeyPart).filter(Boolean).join('|');

const buildPhoneBookPageUrl = (start = 0) => {
  const pageUrl = new URL(PHONE_BOOK_URL);
  if (start > 0) pageUrl.searchParams.set('start', String(start));
  return pageUrl.toString();
};

const fetchPhoneBookHtml = async (start = 0) => {
  const pageUrl = buildPhoneBookPageUrl(start);
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 EmployeeDirectorySync/1.0',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: 'http://web3.nioch.nsc.ru/'
    }
  });

  if (!response.ok) {
    throw new Error(`Источник справочника вернул HTTP ${response.status} для ${pageUrl}`);
  }

  return response.text();
};

const extractTableRows = (html = '') => {
  const tableMatch = String(html).match(/<table[^>]*id=[\"']cardnList[\"'][^>]*>[\s\S]*?<\/table>/i);
  const tableHtml = tableMatch ? tableMatch[0] : String(html);
  const bodyMatch = tableHtml.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/i);
  const rowsHtml = bodyMatch ? bodyMatch[0] : tableHtml;
  const rows = [];
  const rowMatches = rowsHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const rowHtml of rowMatches) {
    const cellMatches = rowHtml.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    const cells = cellMatches.map(normalizeValue);
    if (cells.length >= 7 && cells[0] && !/^сотрудники$/i.test(cells[0])) {
      rows.push(cells);
    }
  }

  return rows;
};

const pickEmail = (cells) => {
  const joined = cells.join(' ');
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return email ? email[0] : '';
};

const rowToEmployee = (cells) => {
  const normalizedCells = cells.map(normalizeValue);
  const email = pickEmail(normalizedCells);

  return {
    full_name: normalizedCells[0] || '',
    position: normalizedCells[1] || '',
    department: normalizedCells[2] || '',
    room: normalizedCells[3] || '',
    internal_phone: normalizedCells[5] || '',
    email: normalizedCells[6] && normalizedCells[6] !== '""' ? normalizedCells[6] : email
  };
};

const parsePhoneBookEmployees = (html = '') => {
  const rows = extractTableRows(html);
  const employees = [];
  const seen = new Set();

  for (const row of rows) {
    const employee = rowToEmployee(row);
    employee.source_key = createSourceKey(employee);

    if (!employee.full_name || !employee.source_key || seen.has(employee.source_key)) continue;
    seen.add(employee.source_key);
    employees.push(employee);
  }

  return employees;
};


const fetchAllPhoneBookEmployees = async () => {
  const employees = [];
  const seen = new Set();
  const pages = [];

  for (let page = 0; page < PHONE_BOOK_MAX_PAGES; page += 1) {
    const start = page * PHONE_BOOK_PAGE_SIZE;
    const html = await fetchPhoneBookHtml(start);
    const pageEmployees = parsePhoneBookEmployees(html);
    let addedFromPage = 0;

    for (const employee of pageEmployees) {
      if (seen.has(employee.source_key)) continue;
      seen.add(employee.source_key);
      employees.push(employee);
      addedFromPage += 1;
    }

    pages.push({ start, parsed: pageEmployees.length, added: addedFromPage });

    if (pageEmployees.length === 0) break;
  }

  return {
    employees,
    pages,
    expectedPages: PHONE_BOOK_MAX_PAGES,
    lastStart: pages[pages.length - 1]?.start || 0
  };
};

const ensurePhoneBookSchema = async () => {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS phone_book (
      id INT AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(255) NULL,
      full_name VARCHAR(255) NOT NULL,
      position VARCHAR(255) NULL,
      department VARCHAR(255) NULL,
      room VARCHAR(100) NULL,
      internal_phone VARCHAR(100) NULL,
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
    ['updated_at', 'ALTER TABLE phone_book ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
    ['created_at', 'ALTER TABLE phone_book ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP']
  ];

  for (const [column, sql] of alters) {
    if (!existing.has(column)) await pool.execute(sql);
  }

  await pool.execute(`
    UPDATE phone_book
    SET source_key = LOWER(TRIM(CONCAT_WS('|', NULLIF(email, ''), full_name, COALESCE(department, ''), COALESCE(room, ''), COALESCE(internal_phone, ''))))
    WHERE source_key IS NULL OR source_key = ''
  `);

  const indexStatements = [
    'CREATE UNIQUE INDEX uniq_phone_book_source_key ON phone_book (source_key)',
    'CREATE INDEX idx_phone_book_full_name ON phone_book (full_name)',
    'CREATE INDEX idx_phone_book_department ON phone_book (department)',
    'CREATE INDEX idx_phone_book_phone ON phone_book (internal_phone)',
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


const EMPLOYEE_SYNC_FIELDS = [
  ['full_name', 'ФИО'],
  ['position', 'Должность'],
  ['department', 'Отдел'],
  ['room', 'Кабинет'],
  ['internal_phone', 'Телефон вн.'],
  ['email', 'Email']
];

const serializeEmployee = (employee = {}) => ({
  source_key: employee.source_key || '',
  full_name: employee.full_name || '',
  position: employee.position || '',
  department: employee.department || '',
  room: employee.room || '',
  internal_phone: employee.internal_phone || '',
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
          (source_key, full_name, position, department, room, internal_phone, email, is_active, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
          full_name = VALUES(full_name),
          position = VALUES(position),
          department = VALUES(department),
          room = VALUES(room),
          internal_phone = VALUES(internal_phone),
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

  const { employees, pages, expectedPages, lastStart } = await fetchAllPhoneBookEmployees();
  if (employees.length < MIN_SYNC_EMPLOYEES) {
    const error = new Error(`Из справочника получено слишком мало записей: ${employees.length}`);
    error.status = 503;
    throw error;
  }

  const stats = await syncEmployees(employees);
  return { total: stats.activeAfter, synced: true, pages, expectedPages, lastStart };
};

// Поиск сотрудников
router.get('/search', async (req, res) => {
  console.log('Поиск сотрудников вызван:', new Date().toISOString());
  console.log('Параметры:', req.query);

  try {
    await ensurePhoneBookSchema();

    const { field, query } = req.query;

    if (!field || !query) {
      return res.status(400).json({ error: 'Не указаны поле поиска или запрос' });
    }

    const validFields = ['full_name', 'position', 'department', 'room', 'internal_phone', 'email'];
    if (!validFields.includes(field)) {
      return res.status(400).json({ error: 'Недопустимое поле для поиска' });
    }

    const sql = `SELECT * FROM phone_book WHERE is_active = 1 AND ${field} LIKE ? ORDER BY full_name`;
    const [results] = await pool.execute(sql, [`%${query}%`]);

    console.log('Найдено записей в БД:', results.length);
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

    const { employees, pages, expectedPages, lastStart } = await fetchAllPhoneBookEmployees();

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
      ...stats
    });
  } catch (error) {
    console.error('Employee sync error:', error);
    res.status(500).json({ error: error.message || 'Ошибка обновления справочника сотрудников' });
  }
});

router.ensurePhoneBookData = ensurePhoneBookData;
module.exports = router;
