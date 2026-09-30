const crypto = require('crypto');

const GROUPS = {
  configuration: { title: 'Настройки сервера', tables: ['app_settings'] },
  applications: { title: 'Заявки', tables: ['application', 'application_events', 'application_views'] },
  knowledge: { title: 'База знаний с фотографиями', tables: ['knowledge_base'] },
  accounts: { title: 'Учётные записи и профили', tables: ['users', 'employee_profiles'], roots: ['uploads/profile'], files: ['data/managerNotifications.json'] },
  communication: {
    title: 'Чат, лента и архивы с файлами',
    tables: ['chat_conversations', 'chat_messages', 'chat_message_files', 'chat_read_state', 'chat_files',
      'chat_message_versions', 'feed_posts', 'feed_comments', 'feed_reactions', 'feed_post_files',
      'records_archives', 'records_archive_items', 'records_archive_files', 'records_archive_periods',
      'records_archive_access', 'records_legal_holds', 'records_legal_hold_items', 'records_audit_log'],
    roots: ['uploads/chat', 'uploads/feed', 'data/records-archives', 'data/backups/message-journal'],
    files: ['data/chatThreads.json', 'data/employeeFeed.json']
  }
};
const EXCLUDED = new Set(['phone_book', 'network_map_snapshot', 'auth_sessions']);
const MAX_BYTES = 512 * 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const identifier = (value) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw fail('Некорректное имя таблицы или колонки');
  return `\`${value}\``;
};
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const orderTables = (tables) => {
  const ordered = [];
  const remaining = new Map(tables.map((table) => [table.name, table]));
  while (remaining.size) {
    const next = [...remaining.values()].find((table) => {
      const references = [...table.schema.matchAll(/REFERENCES\s+`([a-zA-Z_][a-zA-Z0-9_]*)`/gi)].map((match) => match[1]);
      return references.every((name) => name === table.name || !remaining.has(name));
    });
    if (!next) throw fail('Таблицы имеют циклические внешние ключи. Для этой схемы нужен отдельный порядок восстановления.');
    ordered.push(next);
    remaining.delete(next.name);
  }
  return ordered;
};
const getGroups = (tables) => {
  const known = new Set(Object.values(GROUPS).flatMap((group) => group.tables));
  return {
    ...GROUPS,
    other: { title: 'Прочие локальные таблицы', tables: tables.filter((table) => !known.has(table.toLowerCase()) && !EXCLUDED.has(table.toLowerCase())) },
    all: { title: 'Все локальные данные', tables: tables.filter((table) => !EXCLUDED.has(table.toLowerCase())),
      roots: Object.values(GROUPS).flatMap((group) => group.roots || []),
      files: Object.values(GROUPS).flatMap((group) => group.files || []) }
  };
};
const sqlValue = (value) => {
  if (value == null) return 'NULL';
  const text = value instanceof Date ? value.toISOString().replace('T', ' ').replace(/Z$/, '')
    : typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : String(value);
  const literal = `X'${(Buffer.isBuffer(value) ? value : Buffer.from(text, 'utf8')).toString('hex')}'`;
  return Buffer.isBuffer(value) ? literal : `CONVERT(${literal} USING utf8mb4)`;
};

// Standard SQL for MySQL tools; the application importer parses only data,
// and never executes SQL or schema text supplied by the upload.
const makeSql = (group, tables) => {
  tables = orderTables(tables);
  const lines = [`-- React_Suz backup v1 ${group}`, 'SET NAMES utf8mb4;', "SET time_zone = '+00:00';"];
  for (const table of tables) {
    lines.push(`-- BEGIN SCHEMA ${table.name}`);
    if (table.definition) lines.push(`-- TABLE META ${Buffer.from(JSON.stringify(table.definition)).toString('base64')}`);
    lines.push(`${table.schema.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')};`, '-- END SCHEMA');
  }
  lines.push('START TRANSACTION;');
  for (const table of [...tables].reverse()) lines.push(`DELETE FROM ${identifier(table.name)};`);
  for (const table of tables) {
    const columns = table.columns.map(identifier).join(',');
    for (const row of table.rows) {
      lines.push(`INSERT INTO ${identifier(table.name)} (${columns}) VALUES (${table.columns.map((column) => sqlValue(row[column])).join(',')});`);
    }
  }
  lines.push('COMMIT;');
  const body = `${lines.join('\n')}\n`;
  return `${body}-- SHA256 ${digest(body)}\n`;
};

const parseSql = (sql, expectedGroup, allowedTables) => {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > MAX_BYTES) throw fail('Дамп превышает лимит 512 МБ', 413);
  const footer = sql.match(/-- SHA256 ([a-f0-9]{64})\n?$/);
  if (!footer || digest(sql.slice(0, footer.index)) !== footer[1]) throw fail('Дамп повреждён или сохранён не полностью');
  const lines = sql.slice(0, footer.index).split('\n');
  if (lines.shift() !== `-- React_Suz backup v1 ${expectedGroup}`) throw fail('Выберите дамп нужного раздела, созданный в настройках React_Suz');
  const tables = new Map();
  let schema = false;
  let phase = 'header';
  for (const line of lines) {
    if (!line) continue;
    const start = line.match(/^-- BEGIN SCHEMA ([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (start) {
      if (schema || phase !== 'header' || EXCLUDED.has(start[1].toLowerCase()) || (allowedTables && !allowedTables.includes(start[1])) || tables.has(start[1])) throw fail('Некорректный список таблиц');
      tables.set(start[1], { name: start[1], columns: null, rows: [] });
      schema = start[1];
      continue;
    }
    if (line === '-- END SCHEMA') { if (!schema) throw fail('Некорректная схема'); schema = false; continue; }
    if (schema && line.startsWith('-- TABLE META ')) {
      try { tables.get(schema).definition = JSON.parse(Buffer.from(line.slice(14), 'base64').toString('utf8')); }
      catch { throw fail('Повреждено описание структуры таблицы'); }
      continue;
    }
    if (schema) continue; // Deliberately never executed, including CREATE TABLE.
    if (phase === 'header' && ['SET NAMES utf8mb4;', "SET time_zone = '+00:00';"].includes(line)) continue;
    if (line === 'START TRANSACTION;' && phase === 'header') { phase = 'delete'; continue; }
    if (line === 'COMMIT;' && ['delete', 'insert'].includes(phase)) { phase = 'done'; continue; }
    const deletion = line.match(/^DELETE FROM `([a-zA-Z_][a-zA-Z0-9_]*)`;$/);
    if (deletion && phase === 'delete') {
      const table = tables.get(deletion[1]);
      if (!table || table.deleteSeen) throw fail('Некорректное удаление в дампе');
      table.deleteSeen = true;
      continue;
    }
    const insertion = line.match(/^INSERT INTO `([a-zA-Z_][a-zA-Z0-9_]*)` \((`[a-zA-Z_][a-zA-Z0-9_]*`(?:,`[a-zA-Z_][a-zA-Z0-9_]*`)*)\) VALUES \((.*)\);$/);
    if (insertion && ['delete', 'insert'].includes(phase)) {
      phase = 'insert';
      const table = tables.get(insertion[1]);
      if (!table?.deleteSeen) throw fail('Неизвестная таблица в дампе');
      const columns = insertion[2].split(',').map((column) => column.slice(1, -1));
      const values = insertion[3].split(',');
      if (new Set(columns).size !== columns.length || columns.length !== values.length
        || (table.columns && table.columns.join(',') !== columns.join(','))) throw fail('Некорректные колонки в дампе');
      table.columns = columns;
      table.rows.push(values.map((value) => {
        if (value === 'NULL') return null;
        const text = value.match(/^CONVERT\(X'((?:[a-f0-9]{2})*)' USING utf8mb4\)$/);
        if (text) return Buffer.from(text[1], 'hex').toString('utf8');
        if (/^X'(?:[a-f0-9]{2})*'$/.test(value)) return Buffer.from(value.slice(2, -1), 'hex');
        throw fail('Дамп содержит неподдерживаемые SQL-команды');
      }));
      continue;
    }
    throw fail('Дамп содержит неподдерживаемые SQL-команды');
  }
  if (schema || phase !== 'done' || !tables.size || [...tables.values()].some((table) => !table.deleteSeen)) throw fail('Неполный дамп');
  return [...tables.values()];
};

const safeFilePath = (name, group) => {
  if (typeof name !== 'string' || name.includes('\\') || name.includes('\0') || name.split('/').some((part) => !part || part === '.' || part === '..')) throw fail('Некорректный путь файла');
  if (!(group.files || []).includes(name) && !(group.roots || []).some((root) => name.startsWith(`${root}/`))) throw fail('Файл не относится к выбранному разделу');
  return name;
};

// Build fresh schemas from constrained metadata, never from uploaded DDL.
const buildCreateSql = (table) => {
  const definition = table.definition;
  if (!definition || !Array.isArray(definition.columns) || !Array.isArray(definition.indexes) || !definition.columns.length || definition.hasForeignKeys) throw fail(`Таблица ${table.name} отсутствует. Подготовьте её миграцией или импортом схемы в MySQL.`);
  const names = new Set();
  const parts = definition.columns.map((column) => {
    const name = identifier(column.Field);
    if (names.has(column.Field)) throw fail('Повторяющаяся колонка в структуре');
    names.add(column.Field);
    const type = String(column.Type || '');
    if (!/^(?:(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|char|varchar|binary|varbinary|tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob|date|datetime|timestamp|time|year|json|boolean)(?:\(\d+(?:,\d+)?\))?(?: unsigned)?(?: zerofill)?|(?:enum|set)\('[\p{L}\p{N}_ .:/+-]*'(?:,'[\p{L}\p{N}_ .:/+-]*')*\))$/iu.test(type)) throw fail(`Неподдерживаемый тип колонки ${column.Field}. Подготовьте таблицу миграцией.`);
    const extra = String(column.Extra || '').toLowerCase().replace(/default_generated/g, '').trim();
    if (extra && !/^(auto_increment|on update current_timestamp(?:\(\d*\))?)$/.test(extra)) throw fail('Неподдерживаемое описание колонки');
    let value = `${name} ${type} ${column.Null === 'YES' ? 'NULL' : 'NOT NULL'}`;
    if (column.Default != null) {
      if (/^(datetime|timestamp)/i.test(type) && /^current_timestamp(?:\(\d*\))?$/i.test(String(column.Default))) value += ` DEFAULT ${column.Default}`;
      else value += ` DEFAULT (CONVERT(X'${Buffer.from(String(column.Default)).toString('hex')}' USING utf8mb4))`;
    } else if (column.Null === 'YES') value += ' DEFAULT NULL';
    if (extra) value += ` ${extra}`;
    return value;
  });
  const indexes = new Map();
  for (const index of definition.indexes) {
    identifier(index.Key_name);
    if (!names.has(index.Column_name) || index.Expression || (index.Index_type && !['BTREE', 'FULLTEXT'].includes(index.Index_type)) || (index.Sub_part != null && (!Number.isSafeInteger(Number(index.Sub_part)) || Number(index.Sub_part) < 1))) throw fail('Неподдерживаемый индекс таблицы');
    const group = indexes.get(index.Key_name) || [];
    group.push(index); indexes.set(index.Key_name, group);
  }
  for (const [name, indexesForKey] of indexes) {
    const columns = indexesForKey.sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index)).map((index) => `${identifier(index.Column_name)}${index.Sub_part ? `(${Number(index.Sub_part)})` : ''}`).join(',');
    parts.push(`${name === 'PRIMARY' ? 'PRIMARY KEY' : `${indexesForKey[0].Index_type === 'FULLTEXT' ? 'FULLTEXT ' : Number(indexesForKey[0].Non_unique) === 0 ? 'UNIQUE ' : ''}KEY ${identifier(name)}`} (${columns})`);
  }
  return `CREATE TABLE ${identifier(table.name)} (${parts.join(',')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
};

const assertReferencedFiles = (tables, files, sourceRoot) => {
  const paths = new Set(files.map((file) => file.path));
  for (const table of tables) {
    for (const row of table.rows) {
      const get = (key) => {
        const value = Array.isArray(row) ? row[table.columns.indexOf(key)] : row[key];
        return Buffer.isBuffer(value) ? value.toString('utf8') : value;
      };
      const expected = [];
      if (table.name === 'employee_profiles' && get('avatar_stored_name')) expected.push(`uploads/profile/${get('avatar_stored_name')}`);
      if (table.name === 'chat_files' && !get('deleted_at')) {
        expected.push(`uploads/${get('relative_path') || `${get('scope')}/${get('stored_name')}`}`);
        let metadata;
        try { metadata = JSON.parse(get('metadata_json') || '{}'); } catch { metadata = {}; }
        if (metadata.thumbnailStoredName) expected.push(`uploads/${get('scope')}/${metadata.thumbnailStoredName}`);
      }
      if (table.name === 'records_archives' && get('storage_path') && !get('deleted_at') && get('status') === 'completed') {
        const prefix = `${sourceRoot}/data/records-archives/`;
        if (!String(get('storage_path')).startsWith(prefix)) throw fail('Архив документов расположен вне каталога программы');
        expected.push(`data/records-archives/${String(get('storage_path')).slice(prefix.length)}`);
      }
      for (const file of expected) if (!paths.has(file)) throw fail(`Вложение отсутствует в резервной копии: ${file}`);
    }
  }
};

module.exports = { GROUPS, EXCLUDED, MAX_BYTES, fail, identifier, digest, getGroups, makeSql, parseSql, safeFilePath, orderTables, assertReferencedFiles, buildCreateSql };
