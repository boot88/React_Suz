const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { makeSql, getGroups, digest } = require('./adminBackup');

const schema = 'CREATE TABLE `knowledge_base` (`id` INT, `title` TEXT, `images` LONGTEXT) ENGINE=InnoDB';
const oldRows = [{ id: 5, title: 'Прежняя статья', images: null }];
let failInsert = false;
let restoring = false;
let rolledBack = false;
let inserted = [];
let exists = true;
let createdSql = '';
const connection = {
  async query(query, values) {
    const sql = typeof query === 'string' ? query : query.sql;
    if (sql.startsWith('SHOW FULL TABLES')) return [exists ? [{ table_name: 'knowledge_base', Table_type: 'BASE TABLE' }] : []];
    if (sql.startsWith('CREATE TABLE')) { exists = true; createdSql = sql; return [[]]; }
    if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'id', Type: 'int', Null: 'NO', Default: null, Extra: '' }, { Field: 'title', Type: 'text', Null: 'YES', Default: null, Extra: '' }, { Field: 'images', Type: 'longtext', Null: 'YES', Default: null, Extra: '' }]];
    if (sql.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': schema }]];
    if (sql.startsWith('SELECT *')) return [oldRows];
    if (sql.startsWith('INSERT INTO')) {
      if (failInsert) throw new Error('Injected insert failure');
      inserted.push(values);
    }
    return [[]];
  },
  async beginTransaction() { restoring = true; },
  async commit() { if (restoring) restoring = false; },
  async rollback() { rolledBack = true; restoring = false; },
  release() {}
};
// Keep these service tests independent of a production database and secrets.
const dbPath = require.resolve('../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getConnection: async () => connection, query: connection.query } };
const { capture, decodeUpload, restore } = require('../routes/adminBackups');
const group = { ...getGroups([]).knowledge, tables: ['knowledge_base'] };
const incoming = () => makeSql('knowledge', [{ name: 'knowledge_base', schema, columns: ['id', 'title', 'images'], rows: [{ id: 7, title: 'Восстановленная статья', images: '[{"data":"data:image/png;base64,eA=="}]' }] }]);

test('restore uses bound parameters, commits data and keeps a usable pre-restore SQL copy', async () => {
  const recoveryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-restore-'));
  inserted = []; rolledBack = false; failInsert = false;
  try {
    const backup = await decodeUpload(Buffer.from(incoming()), 'knowledge', group);
    const result = await restore(backup, 'knowledge', group, { recoveryDir });
    assert.equal(result.tables[0].rows, 1);
    assert.equal(inserted[0][1].toString('utf8'), 'Восстановленная статья');
    assert.equal(rolledBack, false);
    const recovery = await decodeUpload(await fs.readFile(path.join(recoveryDir, result.recoveryName)), 'knowledge', group);
    assert.equal(recovery.tables[0].rows[0][1].toString('utf8'), 'Прежняя статья');
  } finally { await fs.rm(recoveryDir, { recursive: true, force: true }); }
});

test('failed insert rolls back and preserves the old-state recovery file', async () => {
  const recoveryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-restore-'));
  failInsert = true; rolledBack = false;
  try {
    const backup = await decodeUpload(Buffer.from(incoming()), 'knowledge', group);
    await assert.rejects(restore(backup, 'knowledge', group, { recoveryDir }), /Injected insert failure/);
    assert.equal(rolledBack, true);
    const files = await fs.readdir(recoveryDir);
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('.sql'));
  } finally { failInsert = false; await fs.rm(recoveryDir, { recursive: true, force: true }); }
});

test('compressed file backup rejects corrupted contents and path traversal before SQL restore', async () => {
  const accountGroup = { ...getGroups([]).accounts, tables: ['employee_profiles'] };
  const sql = makeSql('accounts', [{ name: 'employee_profiles', schema: 'CREATE TABLE `employee_profiles` (`login` TEXT) ENGINE=InnoDB', columns: ['login'], rows: [] }]);
  const data = Buffer.from('photo');
  const backup = { format: 'React_Suz backup', version: 1, group: 'accounts', sql,
    files: [{ path: 'uploads/profile/test.png', data: data.toString('base64'), sha256: digest('wrong') }] };
  await assert.rejects(decodeUpload(zlib.gzipSync(JSON.stringify(backup)), 'accounts', accountGroup), /повреждён/);
  backup.files[0].sha256 = digest(data);
  backup.files[0].path = 'uploads/profile/../../.env';
  await assert.rejects(decodeUpload(zlib.gzipSync(JSON.stringify(backup)), 'accounts', accountGroup), /путь/);
});

test('capture keeps NULL and original row data without connecting to a real database', async () => {
  const backup = await capture('knowledge');
  const parsed = await decodeUpload(Buffer.from(backup.sql), 'knowledge', group);
  assert.equal(parsed.tables[0].rows[0][2], null);
});

test('restoration creates an absent table from metadata without executing uploaded schema SQL', async () => {
  const recoveryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-empty-'));
  exists = false; createdSql = ''; failInsert = false;
  try {
    const sql = makeSql('knowledge', [{ name: 'knowledge_base', schema: 'CREATE TABLE `knowledge_base` (`id` INT) ENGINE=InnoDB',
      definition: { columns: [{ Field: 'id', Type: 'int', Null: 'NO', Default: null, Extra: '' }], indexes: [] }, columns: ['id'], rows: [{ id: 9 }] }]);
    const backup = await decodeUpload(Buffer.from(sql), 'knowledge', group);
    await restore(backup, 'knowledge', group, { recoveryDir });
    assert.equal(createdSql, 'CREATE TABLE `knowledge_base` (`id` int NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  } finally { exists = true; await fs.rm(recoveryDir, { recursive: true, force: true }); }
});

test('inspection reports verified counts without leaking rows or executing restoration', async () => {
  const { describeBackup } = require('../routes/adminBackups');
  const backup = await decodeUpload(Buffer.from(incoming()), 'knowledge', group);
  inserted = []; rolledBack = false;
  const metadata = describeBackup(backup, 'knowledge');
  assert.deepEqual(metadata, { group: 'knowledge', version: 1, createdAt: null, tables: [{ name: 'knowledge_base', rows: 1 }], rows: 1, files: 0, embeddedImages: 1 });
  assert.equal(JSON.stringify(metadata).includes('Восстановленная статья'), false);
  assert.deepEqual(inserted, []);
  assert.equal(rolledBack, false);
});

test('export allows API reads and blocks writes; restore blocks both and reports completion', async () => {
  const { EventEmitter } = require('node:events');
  const { exclusive, backupGate, maintenanceStatus } = require('../routes/adminBackups');
  const check = (method) => {
    let next = false;
    const res = Object.assign(new EventEmitter(), { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } });
    backupGate({ path: '/api/applications', method }, res, () => { next = true; res.emit('finish'); });
    return { next, res };
  };
  for (const mode of ['export', 'restore']) {
    let release;
    const pending = exclusive(() => new Promise((resolve) => { release = resolve; }), mode);
    assert.equal(maintenanceStatus().operation, mode);
    assert.equal(check('GET').next, mode === 'export');
    assert.equal(check('PUT').res.statusCode, 503);
    release(); await pending; assert.equal(maintenanceStatus().active, false);
  }
});

test('restoration batches rows rather than issuing one INSERT per record', async () => {
  const recoveryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-restore-batch-'));
  inserted = []; failInsert = false;
  try {
    const sql = makeSql('knowledge', [{ name: 'knowledge_base', schema, columns: ['id', 'title', 'images'], rows: Array.from({ length: 205 }, (_, id) => ({ id, title: `Статья ${id}`, images: null })) }]);
    const backup = await decodeUpload(Buffer.from(sql), 'knowledge', group);
    await restore(backup, 'knowledge', group, { recoveryDir });
    assert.equal(inserted.length, 3); assert.deepEqual(inserted.map((batch) => batch.length), [300, 300, 15]);
  } finally { await fs.rm(recoveryDir, { recursive: true, force: true }); }
});
