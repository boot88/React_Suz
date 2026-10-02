const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const db = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { MAX_BYTES, fail, identifier, digest, getGroups, makeSql, parseSql, safeFilePath, assertReferencedFiles, buildCreateSql, GROUPS } = require('../utils/adminBackup');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const serverRoot = path.resolve(__dirname, '..');
const router = express.Router();
let paused = false;
let activeWrites = 0;

// Drain in-flight writes and prevent changes during a snapshot/restore.
// Install before all /api routes. Deployments with multiple server processes
// must stop the other processes during backup/restore (documented in README).
const backupGate = (req, res, next) => {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/backups') || req.method === 'OPTIONS') return next();
  if (paused) {
    return res.status(503).json({ message: 'Выполняется резервное копирование или восстановление. Повторите операцию позже.' });
  }
  if (!req.path.endsWith('/stream')) {
    activeWrites += 1;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; activeWrites -= 1; } };
    res.once('finish', finish);
    res.once('close', finish);
  }
  next();
};

const exclusive = async (operation) => {
  if (paused) throw fail('Другая операция резервного копирования уже выполняется', 409);
  paused = true;
  try {
    const deadline = Date.now() + 30000;
    while (activeWrites) {
      if (Date.now() > deadline) throw fail('Дождитесь завершения текущих загрузок и повторите операцию', 409);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return await operation();
  } finally { paused = false; }
};

const inventory = async (connection = db) => {
  const [rows] = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  return rows.map((row) => Object.values(row)[0]).sort();
};
const resolveGroup = async (key, connection = db) => {
  const tables = await inventory(connection);
  const group = getGroups(tables)[key];
  if (!group) throw fail('Неизвестный раздел резервного копирования');
  return group;
};

const collectFiles = async (group) => {
  const files = [];
  let total = 0;
  const add = async (relative) => {
    safeFilePath(relative, group);
    const target = path.join(serverRoot, relative);
    const stat = await fs.lstat(target).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw fail(`Резервирование символической ссылки запрещено: ${relative}`);
    if (stat.isDirectory()) {
      for (const child of (await fs.readdir(target)).sort()) await add(`${relative}/${child}`);
    } else if (stat.isFile()) {
      total += stat.size;
      if (total > MAX_BYTES / 2) throw fail('Файлы превышают лимит копии. Экспортируйте разделы отдельно (до 256 МБ файлов).', 413);
      const bytes = await fs.readFile(target);
      files.push({ path: relative, data: bytes.toString('base64'), sha256: digest(bytes) });
    }
  };
  for (const root of group.roots || []) {
    // The root itself is a directory; its children must pass safeFilePath.
    const children = await fs.readdir(path.join(serverRoot, root)).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
    const stat = await fs.lstat(path.join(serverRoot, root)).catch(() => null);
    if (stat?.isSymbolicLink()) throw fail('Каталог файлов не должен быть символической ссылкой');
    for (const child of children.sort()) await add(`${root}/${child}`);
  }
  for (const file of group.files || []) await add(file);
  return files;
};

const capture = async (key, existingConnection = null) => {
  const connection = existingConnection || await db.getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const group = await resolveGroup(key, connection);
    const existing = await inventory(connection);
    const present = group.tables.filter((table) => existing.includes(table));
    if (!present.length) throw fail('В этом разделе пока нет таблиц для экспорта');
    const tables = [];
    let size = 0;
    for (const name of present) {
      const [ddl] = await connection.query(`SHOW CREATE TABLE ${identifier(name)}`);
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${identifier(name)}`);
      const [indexes] = await connection.query(`SHOW INDEX FROM ${identifier(name)}`);
      const [rows] = await connection.query({ sql: `SELECT * FROM ${identifier(name)}`, dateStrings: true });
      // CHECK on restore also rejects nontransactional tables.
      if (!/ENGINE=InnoDB\b/i.test(ddl[0]['Create Table'])) throw fail(`Для надёжной копии таблица ${name} должна использовать InnoDB`);
      const table = { name, schema: ddl[0]['Create Table'], definition: { columns, indexes, hasForeignKeys: /\bFOREIGN KEY\b/i.test(ddl[0]['Create Table']) }, columns: columns.filter((column) => !/(VIRTUAL|STORED) GENERATED/i.test(column.Extra)).map((column) => column.Field), rows };
      size += Buffer.byteLength(JSON.stringify(table));
      if (size > MAX_BYTES / 3) throw fail('Данные превышают лимит копии. Экспортируйте разделы отдельно.', 413);
      tables.push(table);
    }
    const files = await collectFiles(group);
    // Snapshot absence of legacy JSON files as empty state, so an older file
    // on the restore host cannot repopulate the restored database.
    for (const file of group.files || []) {
      if (!files.some((entry) => entry.path === file)) {
        const bytes = Buffer.from(file.endsWith('chatThreads.json') ? '{}' : '[]');
        files.push({ path: file, data: bytes.toString('base64'), sha256: digest(bytes) });
      }
    }
    assertReferencedFiles(tables, files, serverRoot);
    const sql = makeSql(key, tables);
    await connection.commit();
    return { format: 'React_Suz backup', version: 1, group: key, createdAt: new Date().toISOString(), serverRoot, sql, files };
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { if (!existingConnection) connection.release(); }
};

const encodePackage = async (backup) => {
  const bytes = Buffer.from(JSON.stringify(backup));
  if (bytes.length > MAX_BYTES) throw fail('Резервная копия превышает лимит 512 МБ. Экспортируйте разделы отдельно.', 413);
  return gzip(bytes);
};

const decodeUpload = async (bytes, key, group) => {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail('Выберите непустой файл');
  let backup;
  if (['applications', 'knowledge', 'other', 'configuration'].includes(key)) {
    backup = { group: key, sql: bytes.toString('utf8'), files: [] };
  } else {
    let decoded;
    try { decoded = await gunzip(bytes, { maxOutputLength: MAX_BYTES }); backup = JSON.parse(decoded.toString('utf8')); }
    catch { throw fail('Архив повреждён или превышает лимит 512 МБ'); }
    if (backup.format !== 'React_Suz backup' || backup.version !== 1 || backup.group !== key || !Array.isArray(backup.files)) throw fail('Архив не относится к выбранному разделу');
  }
  const tables = parseSql(backup.sql, key, ['all', 'other'].includes(key) ? null : group.tables);
  if (key === 'other' && tables.some((table) => Object.values(GROUPS).some((known) => known.tables.includes(table.name.toLowerCase())))) throw fail('Этот дамп относится к другому разделу');
  const paths = new Set();
  for (const file of backup.files) {
    safeFilePath(file.path, group);
    if (paths.has(file.path) || typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw fail('Некорректный файл в архиве');
    paths.add(file.path);
    if (digest(Buffer.from(file.data, 'base64')) !== file.sha256) throw fail(`Файл повреждён: ${file.path}`);
  }
  assertReferencedFiles(tables, backup.files, backup.serverRoot);
  if ((group.files || []).some((file) => !paths.has(file))) throw fail('В архиве отсутствуют файлы состояния выбранного раздела');
  const users = tables.find((table) => table.name === 'users');
  if (users && !users.rows.some((row) => row[users.columns.indexOf('role')]?.toString('utf8') === 'admin' && row[users.columns.indexOf('password')]?.length)) throw fail('В копии учётных записей нет администратора с паролем');
  return { ...backup, tables };
};

// Only counts and metadata are returned; original records and file contents stay private.
const describeBackup = (backup, key) => {
  let embeddedImages = 0;
  for (const table of backup.tables) {
    if (table.name !== 'knowledge_base') continue;
    const index = table.columns?.indexOf('images') ?? -1;
    if (index < 0) continue;
    for (const row of table.rows) {
      try {
        const images = JSON.parse(String(row[index] || '[]'));
        if (Array.isArray(images)) embeddedImages += images.length;
      } catch { /* Legacy image fields can be empty or malformed. */ }
    }
  }
  return {
    group: key, version: 1,
    createdAt: backup.createdAt && Number.isFinite(Date.parse(backup.createdAt)) ? new Date(backup.createdAt).toISOString() : null,
    tables: backup.tables.map((table) => ({ name: table.name, rows: table.rows.length })),
    rows: backup.tables.reduce((sum, table) => sum + table.rows.length, 0),
    files: backup.files.length, embeddedImages
  };
};

const assertNoSymlinks = async (relative) => {
  let current = serverRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isSymbolicLink()) throw fail('Восстановление через символическую ссылку запрещено');
  }
};

const restore = async (backup, key, group, options = {}) => {
  const connection = await db.getConnection();
  const rollbackFiles = [];
  let stage;
  let preserveStage = false;
  try {
    // Complete schema validation before any changes or filesystem writes.
    const existing = await inventory(connection);
    const missing = backup.tables.filter((table) => !existing.includes(table.name));
    const statements = missing.map(buildCreateSql); // Validate every new schema first.
    for (const statement of statements) await connection.query(statement);
    for (const table of backup.tables) {
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${identifier(table.name)}`);
      const names = new Set(columns.filter((column) => !/(VIRTUAL|STORED) GENERATED/i.test(column.Extra)).map((column) => column.Field));
      if (table.columns?.some((column) => !names.has(column))) throw fail(`Схема таблицы ${table.name} отличается от дампа. Обновите программу до совместимой версии.`);
      const [ddl] = await connection.query(`SHOW CREATE TABLE ${identifier(table.name)}`);
      if (!/ENGINE=InnoDB\b/i.test(ddl[0]['Create Table'])) throw fail(`Восстановление требует InnoDB: ${table.name}`);
    }
    for (const file of backup.files) await assertNoSymlinks(file.path);
    // A pre-restore copy is kept on the server even when a restore succeeds.
    const recovery = await capture(key, connection);
    const recoveryDir = options.recoveryDir || path.join(serverRoot, 'data', 'admin-restore-recovery');
    await fs.mkdir(recoveryDir, { recursive: true });
    const sqlOnly = ['applications', 'knowledge', 'other', 'configuration'].includes(key);
    const recoveryName = `${Date.now()}-${key}${sqlOnly ? '.sql' : '.suz.gz'}`;
    await fs.writeFile(path.join(recoveryDir, recoveryName), sqlOnly ? Buffer.from(recovery.sql) : await encodePackage(recovery), { flag: 'wx', mode: 0o600 });
    stage = await fs.mkdtemp(path.join(recoveryDir, 'restore-'));
    for (let i = 0; i < backup.files.length; i += 1) {
      await fs.writeFile(path.join(stage, `${i}.new`), Buffer.from(backup.files[i].data, 'base64'), { mode: 0o600 });
    }
    await connection.query("SET time_zone = '+00:00'");
    await connection.beginTransaction();
    // Lock all affected tables' records, then replace within one transaction.
    for (const table of backup.tables) await connection.query(`SELECT 1 FROM ${identifier(table.name)} FOR UPDATE`);
    for (const table of [...backup.tables].reverse()) await connection.query(`DELETE FROM ${identifier(table.name)}`);
    for (const table of backup.tables) {
      for (const values of table.rows) {
        const row = [...values];
        // Absolute archive paths must follow the new installation directory.
        const index = table.name === 'records_archives' ? table.columns.indexOf('storage_path') : -1;
        if (index >= 0 && row[index] && backup.serverRoot) {
          const original = row[index].toString('utf8');
          const prefix = `${backup.serverRoot}/data/records-archives/`;
          if (original.startsWith(prefix)) {
            const relative = `data/records-archives/${original.slice(prefix.length)}`;
            safeFilePath(relative, group);
            row[index] = Buffer.from(path.join(serverRoot, relative));
          }
        }
        await connection.query(`INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(',')}) VALUES (${row.map(() => '?').join(',')})`, row);
      }
    }
    if (['accounts', 'all'].includes(key) && (await inventory(connection)).includes('auth_sessions')) {
      await connection.query('DELETE FROM auth_sessions');
    }
    // Remove files absent from the snapshot as well: especially newer journal
    // segments must not resurrect records after restoring an older copy.
    const incomingPaths = new Set(backup.files.map((file) => file.path));
    const currentFiles = await collectFiles(group);
    let removedIndex = 0;
    for (const file of currentFiles.filter((entry) => !incomingPaths.has(entry.path))) {
      const target = path.join(serverRoot, file.path);
      const old = path.join(stage, `removed-${removedIndex++}.old`);
      await fs.rename(target, old);
      rollbackFiles.push({ target, old, existed: true });
    }
    for (let i = 0; i < backup.files.length; i += 1) {
      const target = path.join(serverRoot, backup.files[i].path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const old = path.join(stage, `${i}.old`);
      let existed = true;
      await fs.rename(target, old).catch((error) => { if (error.code === 'ENOENT') existed = false; else throw error; });
      rollbackFiles.push({ target, old, existed });
      await fs.rename(path.join(stage, `${i}.new`), target);
    }
    await connection.commit();
    // Clear legacy in-memory chat state after replacement, then force clients
    // to reconnect/read the SQL snapshot on the next page load.
    if (['communication', 'all'].includes(key)) {
      try { require('./chat').resetAfterAdminRestore(); } catch (error) { console.error('Chat cache reset failed:', error.message); }
    }
    return { tables: backup.tables.map((table) => ({ name: table.name, rows: table.rows.length })), files: backup.files.length, recoveryName };
  } catch (error) {
    await connection.rollback().catch(() => {});
    for (const file of rollbackFiles.reverse()) {
      try {
        await fs.rm(file.target, { force: true });
        if (file.existed) await fs.rename(file.old, file.target);
      } catch (rollbackError) {
        preserveStage = true;
        console.error('Backup file rollback failed:', rollbackError.message, 'Recovery directory:', stage);
      }
    }
    if (preserveStage) throw fail('Ошибка восстановления файлов. Прежняя копия и временные файлы сохранены на сервере; требуется восстановление из server/data/admin-restore-recovery.', 500);
    throw error;
  } finally {
    connection.release();
    if (stage && !preserveStage) await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
};

router.use(requireAuth, requireRole('admin'));
router.get('/recovery/:name', async (req, res) => {
  if (!/^\d+-(applications|knowledge|accounts|communication|other|all|configuration)\.(sql|suz\.gz)$/.test(req.params.name)) return res.status(400).json({ message: 'Некорректное имя копии' });
  const file = path.join(serverRoot, 'data', 'admin-restore-recovery', req.params.name);
  res.setHeader('Cache-Control', 'no-store');
  res.download(file, req.params.name, (error) => {
    if (error && !res.headersSent) res.status(404).json({ message: 'Копия не найдена' });
  });
});
router.get('/', async (req, res) => {
  try {
    const names = await inventory();
    res.json(Object.entries(getGroups(names)).map(([key, group]) => ({ key, title: group.title, tables: group.tables.filter((name) => names.includes(name)), extension: ['applications', 'knowledge', 'other', 'configuration'].includes(key) ? '.sql' : '.suz.gz' })));
  } catch (error) { res.status(error.status || 500).json({ message: error.message }); }
});
router.get('/:group/export', async (req, res) => {
  try {
    const key = req.params.group;
    const backup = await exclusive(() => capture(key));
    const sqlOnly = ['applications', 'knowledge', 'other', 'configuration'].includes(key);
    const bytes = sqlOnly ? Buffer.from(backup.sql) : await encodePackage(backup);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="react-suz-${key}-${new Date().toISOString().slice(0, 10)}${sqlOnly ? '.sql' : '.suz.gz'}"`);
    res.type(sqlOnly ? 'application/sql' : 'application/gzip').send(bytes);
  } catch (error) { res.status(error.status || 500).json({ message: error.message }); }
});
router.post('/:group/inspect', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), async (req, res) => {
  try {
    const key = req.params.group;
    const group = await resolveGroup(key);
    const backup = await decodeUpload(req.body, key, group);
    res.setHeader('Cache-Control', 'no-store');
    res.json(describeBackup(backup, key));
  } catch (error) { res.status(error.status || 500).json({ message: error.message }); }
});
router.post('/:group/import', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), async (req, res) => {
  try {
    if (req.headers['x-confirm-restore'] !== 'replace') throw fail('Подтвердите замену данных');
    const result = await exclusive(async () => {
      const group = await resolveGroup(req.params.group);
      const backup = await decodeUpload(req.body, req.params.group, group);
      return restore(backup, req.params.group, group);
    });
    res.json({ message: 'Данные восстановлены. Обновите страницу. Копия прежних данных сохранена на сервере.', ...result });
  } catch (error) { res.status(error.status || 500).json({ message: error.message }); }
});

module.exports = { router, backupGate, capture, decodeUpload, describeBackup, restore, exclusive };
