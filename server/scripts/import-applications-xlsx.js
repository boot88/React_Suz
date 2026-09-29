/**
 * Импорт заявок из Excel (.xlsx) в таблицу MySQL `application`.
 *
 * Запуск:
 *   node server/scripts/import-applications-xlsx.js [путь-к-xlsx]
 *
 * По умолчанию читает файл из «Загрузки»:
 *   /home/qwest/Загрузки/все_заявки_19-08-2026.xlsx
 *
 * Скрипт:
 *   1. Создаёт базовую таблицу `application`, если её ещё нет.
 *   2. Достраивает колонки workflow (status, created_at, source и т.д.),
 *      зеркально тому, что делает `ensureApplicationWorkflowSchema` на сервере.
 *   3. Переносит строки из Excel с сохранением исходных ID.
 *
 * Скрипт идемпотентен: повторный запуск обновляет уже существующие заявки
 * по id (ON DUPLICATE KEY UPDATE), а не дублирует их.
 */

const ExcelJS = require('exceljs');
const pool = require('../config/database');

const DEFAULT_XLSX_PATH = '/home/qwest/Загрузки/все_заявки_19-08-2026.xlsx';

const BASE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS application (
    \`id\` INT NOT NULL AUTO_INCREMENT,
    \`name\` VARCHAR(255) NOT NULL DEFAULT '',
    \`cabinet\` VARCHAR(255) NOT NULL DEFAULT '',
    \`N_tel\` VARCHAR(255) NOT NULL DEFAULT '',
    \`application\` TEXT,
    \`process\` TEXT,
    \`executor\` VARCHAR(255) NOT NULL DEFAULT '',
    \`data\` DATETIME NULL,
    \`start_data\` DATETIME NULL,
    \`end_data\` DATETIME NULL,
    \`fl\` TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

// Порядок и типы полностью совпадают с APPLICATION_WORKFLOW_ALTERS в server/server.js.
const WORKFLOW_COLUMNS = [
  ['status', "ALTER TABLE application ADD COLUMN `status` VARCHAR(40) NULL DEFAULT 'new'"],
  ['created_at', 'ALTER TABLE application ADD COLUMN `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP'],
  ['updated_at', 'ALTER TABLE application ADD COLUMN `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ['employee_login', 'ALTER TABLE application ADD COLUMN `employee_login` VARCHAR(255) NULL'],
  ['category', 'ALTER TABLE application ADD COLUMN `category` VARCHAR(80) NULL'],
  ['priority', 'ALTER TABLE application ADD COLUMN `priority` VARCHAR(40) NULL'],
  ['accepted_by', 'ALTER TABLE application ADD COLUMN `accepted_by` VARCHAR(255) NULL'],
  ['accepted_at', 'ALTER TABLE application ADD COLUMN `accepted_at` DATETIME NULL'],
  ['work_started_at', 'ALTER TABLE application ADD COLUMN `work_started_at` DATETIME NULL'],
  ['resolved_at', 'ALTER TABLE application ADD COLUMN `resolved_at` DATETIME NULL'],
  ['employee_confirmed_at', 'ALTER TABLE application ADD COLUMN `employee_confirmed_at` DATETIME NULL'],
  ['admin_comment', 'ALTER TABLE application ADD COLUMN `admin_comment` TEXT NULL'],
  ['eta_minutes', 'ALTER TABLE application ADD COLUMN `eta_minutes` INT NULL'],
  ['waiting_seconds', 'ALTER TABLE application ADD COLUMN `waiting_seconds` INT NULL'],
  ['arrival_seconds', 'ALTER TABLE application ADD COLUMN `arrival_seconds` INT NULL'],
  ['work_seconds', 'ALTER TABLE application ADD COLUMN `work_seconds` INT NULL'],
  ['source', "ALTER TABLE application ADD COLUMN `source` VARCHAR(40) NOT NULL DEFAULT 'admin'"],
  ['chat_thread_id', 'ALTER TABLE application ADD COLUMN `chat_thread_id` VARCHAR(255) NULL'],
  ['source_message_id', 'ALTER TABLE application ADD COLUMN `source_message_id` VARCHAR(255) NULL'],
  ['employee_comment', 'ALTER TABLE application ADD COLUMN `employee_comment` TEXT NULL'],
  ['sla_paused_at', 'ALTER TABLE application ADD COLUMN `sla_paused_at` DATETIME NULL'],
  ['sla_paused_seconds', 'ALTER TABLE application ADD COLUMN `sla_paused_seconds` INT NULL'],
  ['idempotency_key', 'ALTER TABLE application ADD COLUMN `idempotency_key` VARCHAR(128) NULL'],
  ['deleted_at', 'ALTER TABLE application ADD COLUMN `deleted_at` DATETIME NULL'],
  ['deleted_by', 'ALTER TABLE application ADD COLUMN `deleted_by` VARCHAR(255) NULL'],
  ['source_attachments_json', 'ALTER TABLE application ADD COLUMN `source_attachments_json` LONGTEXT NULL'],
  ['work_cycles_json', 'ALTER TABLE application ADD COLUMN `work_cycles_json` LONGTEXT NULL']
];

// Статусы из Excel (русские метки, как в файле) -> внутренние статусы приложения.
const STATUS_MAP = {
  'Выполнено': 'done',
  'Выполнена': 'done',
  'Новая': 'new',
  'В работе': 'in_progress',
  'Отменено': 'reopened',
  'Переоткрыта': 'reopened',
  'Принята': 'accepted',
  'Ждёт подтверждения': 'waiting_employee_confirmation'
};

const pad2 = (value) => String(value).padStart(2, '0');

/**
 * Преобразует русскую дату из Excel вида «DD.MM.YYYY, HH:mm:ss»
 * (или «DD.MM.YYYY») в MySQL-формат «YYYY-MM-DD HH:mm:ss».
 */
const parseRuDateTime = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const mo = pad2(value.getMonth() + 1);
    const d = pad2(value.getDate());
    const h = pad2(value.getHours());
    const mi = pad2(value.getMinutes());
    const s = pad2(value.getSeconds());
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
  }
  const raw = String(value).trim();
  if (!raw || raw === '-') return null;
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) {
    console.warn(`Не удалось разобрать дату: ${JSON.stringify(value)}`);
    return null;
  }
  const day = pad2(match[1]);
  const month = pad2(match[2]);
  const year = match[3];
  const hours = match[4] ? pad2(match[4]) : '00';
  const minutes = match[5] ? pad2(match[5]) : '00';
  const seconds = match[6] ? pad2(match[6]) : '00';
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/** Пустые значения и прочерки «-» приводим к пустой строке. */
const cleanCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text === '-' ? '' : text;
};

const ensureSchema = async () => {
  const [tables] = await pool.execute('SHOW TABLES LIKE "application"');
  if (!tables.length) {
    await pool.query(BASE_TABLE_SQL);
    console.log('Создана базовая таблица `application`.');
  }

  const [columns] = await pool.execute('SHOW COLUMNS FROM application');
  const existing = new Set(columns.map((column) => column.Field));

  for (const [columnName, alterSql] of WORKFLOW_COLUMNS) {
    if (existing.has(columnName)) continue;
    try {
      await pool.execute(alterSql);
      console.log(`Добавлена колонка workflow: ${columnName}`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS application_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      application_id INT NOT NULL,
      actor_login VARCHAR(255) NULL,
      actor_role VARCHAR(40) NULL,
      event_type VARCHAR(80) NOT NULL,
      comment TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_application_events_application_id (application_id)
    )
  `).catch((error) => {
    if (error.code !== 'ER_TABLE_EXISTS_ERROR') throw error;
  });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS application_views (
      id INT AUTO_INCREMENT PRIMARY KEY,
      application_id INT NOT NULL,
      admin_login VARCHAR(255) NOT NULL,
      viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_application_view_admin (application_id, admin_login),
      INDEX idx_application_views_admin_login (admin_login),
      INDEX idx_application_views_application_id (application_id)
    )
  `).catch((error) => {
    if (error.code !== 'ER_TABLE_EXISTS_ERROR') throw error;
  });
};

const INSERT_SQL = `
  INSERT INTO application (
    \`id\`, \`name\`, \`cabinet\`, \`N_tel\`, \`application\`, \`process\`, \`executor\`,
    \`data\`, \`start_data\`, \`end_data\`, \`fl\`, \`status\`, \`created_at\`,
    \`source\`, \`work_started_at\`, \`resolved_at\`, \`employee_confirmed_at\`
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  AS new
  ON DUPLICATE KEY UPDATE
    \`name\` = new.\`name\`,
    \`cabinet\` = new.\`cabinet\`,
    \`N_tel\` = new.\`N_tel\`,
    \`application\` = new.\`application\`,
    \`process\` = new.\`process\`,
    \`executor\` = new.\`executor\`,
    \`data\` = new.\`data\`,
    \`start_data\` = new.\`start_data\`,
    \`end_data\` = new.\`end_data\`,
    \`fl\` = new.\`fl\`,
    \`status\` = new.\`status\`,
    \`created_at\` = new.\`created_at\`,
    \`source\` = new.\`source\`,
    \`work_started_at\` = new.\`work_started_at\`,
    \`resolved_at\` = new.\`resolved_at\`,
    \`employee_confirmed_at\` = new.\`employee_confirmed_at\`
`;

const readRows = async (xlsxPath) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const worksheet = workbook.worksheets[0];
  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = worksheet.getRow(rowNumber).values;
    // Колонки: 1=ID, 2=Клиент, 3=Кабинет, 4=Телефон, 5=Заявка, 6=Что сделано,
    // 7=Исполнитель, 8=Дата подачи, 9=Дата начала, 10=Дата окончания, 11=Статус
    const rawId = values[1];
    if (rawId === null || rawId === undefined || rawId === '') continue;
    const id = Number(rawId);
    if (!Number.isFinite(id)) continue;

    const rawStatus = cleanCell(values[11]);
    const status = STATUS_MAP[rawStatus] || 'new';
    const done = status === 'done';

    const data = parseRuDateTime(values[8]);
    const startData = parseRuDateTime(values[9]);
    const endData = parseRuDateTime(values[10]);

    rows.push({
      id,
      name: cleanCell(values[2]),
      cabinet: cleanCell(values[3]),
      N_tel: cleanCell(values[4]),
      application: cleanCell(values[5]),
      process: cleanCell(values[6]),
      executor: cleanCell(values[7]),
      data,
      start_data: startData,
      end_data: done ? endData : null,
      fl: done ? 1 : 0,
      status,
      created_at: data,
      source: 'admin',
      work_started_at: startData,
      resolved_at: done ? endData : null,
      employee_confirmed_at: done ? endData : null
    });
  }
  return rows;
};

const main = async () => {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX_PATH;
  console.log(`Читаю файл: ${xlsxPath}`);

  const rows = await readRows(xlsxPath);
  console.log(`Найдено строк в Excel: ${rows.length}`);

  const ids = rows.map((row) => row.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    console.warn(`Внимание: в файле есть повторяющиеся ID (${ids.length - uniqueIds.size} шт.).`);
  }
  if (rows.length) {
    console.log(`Диапазон ID: ${Math.min(...ids)} — ${Math.max(...ids)}`);
  }

  await ensureSchema();

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const params = [
      row.id, row.name, row.cabinet, row.N_tel, row.application, row.process,
      row.executor, row.data, row.start_data, row.end_data, row.fl, row.status,
      row.created_at, row.source, row.work_started_at, row.resolved_at,
      row.employee_confirmed_at
    ];
    const [result] = await pool.execute(INSERT_SQL, params);
    if (result.affectedRows === 1) inserted += 1;
    else if (result.affectedRows === 2) updated += 1;
  }

  const [maxRow] = await pool.execute('SELECT MAX(`id`) AS maxId FROM application');
  const nextId = (Number(maxRow[0].maxId) || 0) + 1;
  await pool.execute(`ALTER TABLE application AUTO_INCREMENT = ${nextId}`);

  const [count] = await pool.execute('SELECT COUNT(*) AS total FROM application');
  console.log('Готово.');
  console.log(`  Вставлено новых заявок: ${inserted}`);
  console.log(`  Обновлено существующих: ${updated}`);
  console.log(`  Всего заявок в таблице: ${count[0].total}`);
  console.log(`  AUTO_INCREMENT установлен на: ${nextId}`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Ошибка импорта:', error);
    process.exit(1);
  });

