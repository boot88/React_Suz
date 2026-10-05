const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { EventEmitter } = require('node:events');
let row;
let writes = 0;
let commits = 0;
let rollbacks = 0;
const calls = [];
const execute = async (sql, params = []) => {
  calls.push({ sql, params });
  if (sql.startsWith('SHOW COLUMNS')) return [Object.keys(row).map((Field) => ({ Field, Type: 'varchar(255)' }))];
  if (sql.startsWith('SELECT') && sql.includes('FROM application WHERE `id` = ?')) return [[{ ...row }]];
  if (sql.startsWith('SELECT') && sql.includes('COUNT(*) AS total')) return [[{ total: 1, pending: 1 }]];
  if (sql.startsWith('SELECT') && sql.includes('FROM application WHERE `deleted_at`')) return [[{ ...row }]];
  if (sql.startsWith('UPDATE application SET') && !sql.includes('CASE')) {
    writes += 1;
    row.revision += 1;
    const set = sql.slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE '));
    let index = 0;
    for (const assignment of set.split(',')) {
      const match = assignment.trim().match(/^`?(\w+)`?\s*=\s*(\?|NULL|0|1)$/);
      if (match) row[match[1]] = match[2] === '?' ? params[index++] : match[2] === 'NULL' ? null : Number(match[2]);
    }
    return [{ affectedRows: 1 }];
  }
  return [[]];
};
const connection = { execute, beginTransaction: async () => {}, commit: async () => { commits += 1; }, rollback: async () => { rollbacks += 1; }, release() {} };
const replaceModule = (name, exports) => {
  const file = require.resolve(name);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
replaceModule('../config/database', { execute, getConnection: async () => connection });
for (const route of ['employees', 'auth', 'chat', 'knowledgeBase', 'networkMap', 'appSettings']) replaceModule(`../routes/${route}`, express.Router());
replaceModule('../routes/adminBackups', { router: express.Router(), backupGate: (req, res, next) => next(), maintenanceEvents: new EventEmitter(), maintenanceStatus: () => ({ active: false }) });
const { app } = require('../server');
const invoke = async (method, path, body = {}, query = {}) => {
  const route = app._router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const req = { params: { id: '7' }, body, query, auth: { login: 'admin', role: 'admin' } };
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle(req, response);
  return response;
};
test.beforeEach(() => {
  row = { id: 7, revision: 2, name: 'Иванов Иван', cabinet: '15', N_tel: '555', application: 'Принтер', executor: 'Иванов И.И.', process: '', status: 'in_progress', fl: 0, source: 'admin', created_at: new Date(Date.now() - 3600000), work_started_at: new Date(Date.now() - 900000), accepted_at: new Date(Date.now() - 900000), work_seconds: 0, work_cycles_json: '[]', deleted_at: null };
  writes = 0; commits = 0; rollbacks = 0; calls.length = 0;
});
test('assigning an executor preserves workflow and clocks; repeating it makes no write', async () => {
  const started = row.work_started_at;
  const result = await invoke('post', '/api/applications/:id/assign', { executor: 'Петров П.П.' });
  assert.equal(result.statusCode, 200);
  assert.equal(row.status, 'in_progress');
  assert.equal(row.work_started_at, started);
  assert.equal(row.revision, 3);
  await invoke('post', '/api/applications/:id/assign', { executor: 'Петров П.П.' });
  assert.equal(writes, 1);
});
test('an old edit cannot undo another administrator’s assignment', async () => {
  const old = { ...row };
  await invoke('post', '/api/applications/:id/assign', { executor: 'Петров П.П.' });
  const result = await invoke('put', '/api/applications/:id', { ...old, application: 'Новое описание' });
  assert.equal(result.statusCode, 409);
  assert.equal(row.executor, 'Петров П.П.');
  assert.equal(row.application, 'Принтер');
  assert.equal(rollbacks, 1);
});
test('a current edit commits once and increments the revision', async () => {
  const result = await invoke('put', '/api/applications/:id', { ...row, application: 'Путь C:\\Temp\\"file"' });
  assert.equal(result.statusCode, 200);
  assert.equal(row.application, 'Путь C:\\Temp\\"file"');
  assert.equal(row.revision, 3);
  assert.equal(writes, 1);
  assert.equal(commits, 1);
});
test('confirm includes waiting only once and repeats return the existing result', async () => {
  row.status = 'waiting_employee_confirmation'; row.work_seconds = 600;
  row.resolved_at = new Date(Date.now() - 300000);
  const first = await invoke('post', '/api/applications/:id/confirm');
  assert.equal(first.statusCode, 200);
  assert.ok(row.work_seconds >= 899 && row.work_seconds <= 900);
  const duration = row.work_seconds, closedAt = row.employee_confirmed_at;
  const second = await invoke('post', '/api/applications/:id/confirm');
  assert.equal(second.statusCode, 200);
  assert.equal(row.work_seconds, duration);
  assert.equal(row.employee_confirmed_at, closedAt);
  assert.equal(writes, 1);
});
test('repeated taking into work does not reset its start or add a cycle', async () => {
  const started = row.work_started_at;
  await invoke('post', '/api/applications/:id/accept', { executor: 'Иванов И.И.' });
  assert.equal(row.work_started_at, started);
  assert.equal(writes, 0);
});
test('reopening a finished request does not add the idle interval', async () => {
  row.status = 'done'; row.fl = 1; row.work_seconds = 900;
  row.resolved_at = new Date(Date.now() - 3600000);
  await invoke('post', '/api/applications/:id/reopen');
  assert.equal(row.work_seconds, 900);
  assert.equal(row.status, 'reopened');
});
test('invalid optional edit fields prevent writes', async () => {
  for (const changes of [{ N_tel: 'abc' }, { cabinet: 'x'.repeat(16) }, { executor: '123' }, { process: 'x'.repeat(1501) }]) {
    const result = await invoke('put', '/api/applications/:id', { ...row, ...changes });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(writes, 0);
});
test('one page uses one combined count and clamps a now-empty page', async () => {
  const result = await invoke('get', '/api/applications', {}, { page: '20', limit: '10' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.currentPage, 1);
  assert.equal(calls.filter(({ sql }) => sql.includes('COUNT(*) AS total')).length, 1);
});
