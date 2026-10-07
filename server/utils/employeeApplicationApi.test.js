const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { EventEmitter } = require('node:events');
let applications = new Map(), events = [], nextId = 1, failCancellationEvent = false;
const active = () => [...applications.values()].filter(row => !row.deleted_at);
const execute = async (sql, params = []) => {
  if (sql.startsWith('SHOW COLUMNS')) return [['id', 'revision', 'status', 'created_at', 'deleted_at'].map(Field => ({ Field, Type: 'varchar(255)' }))];
  if (/^(ALTER|CREATE)/.test(sql.trim()) || sql.includes('UPDATE application\n')) return [[]];
  if (sql.startsWith('SELECT full_name, phone, room FROM users')) return [[{ full_name: 'Сотрудник Иван', phone: '123', room: '10' }]];
  if (sql.startsWith('SELECT `id` FROM application WHERE `idempotency_key`')) return [[...applications.values()].filter(row => row.idempotency_key === params[0]).map(row => ({ id: row.id }))];
  if (sql.startsWith('SELECT') && sql.includes('FROM application WHERE `id` = ?')) {
    const row = applications.get(Number(params[0]));
    return [[...(row && (!sql.includes('AND `deleted_at` IS NULL') || !row.deleted_at) ? [{ ...row }] : [])]];
  }
  if (sql.startsWith('INSERT INTO application (')) {
    const fields = sql.match(/application \(([^)]+)\)/)[1].split(',').map(field => field.trim().replace(/`/g, ''));
    const row = { id: nextId++, revision: 0, deleted_at: null, work_seconds: 0, work_cycles_json: '[]', ...Object.fromEntries(fields.map((field, index) => [field, params[index]])) };
    applications.set(row.id, row); return [{ insertId: row.id, affectedRows: 1 }];
  }
  if (sql.startsWith('INSERT INTO application_events')) {
    if (failCancellationEvent && params[3] === 'cancelled_by_employee') throw new Error('Event storage unavailable');
    events.push({ id: params[0], type: params[3], comment: params[4] }); return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('UPDATE application SET') && sql.includes('`deleted_at` = NOW()')) {
    const row = applications.get(Number(params[1])); if (!row || row.deleted_at) return [{ affectedRows: 0 }];
    row.deleted_at = new Date().toISOString(); row.deleted_by = params[0]; row.revision += 1; return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('UPDATE application SET') && !sql.includes('CASE')) {
    const row = applications.get(Number(params.at(-1))); row.revision += 1;
    let index = 0;
    for (const assignment of sql.slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE ')).split(',')) {
      const match = assignment.trim().match(/^`?(\w+)`?\s*=\s*(\?|NULL|0|1)$/);
      if (match) row[match[1]] = match[2] === '?' ? params[index++] : match[2] === 'NULL' ? null : Number(match[2]);
    }
    return [{ affectedRows: 1 }];
  }
  if (sql.startsWith('SELECT COUNT(*) AS count FROM application')) return [[{ count: active().filter(row => ['new', 'reopened'].includes(row.status)).length }]];
  if (sql.startsWith('SELECT') && sql.includes('COUNT(*) AS total')) return [[{ total: active().length, queue: active().filter(row => ['new', 'reopened'].includes(row.status)).length }]];
  if (sql.startsWith('SELECT') && sql.includes('FROM application WHERE LOWER(`employee_login`)')) return [active().filter(row => row.employee_login === params[0]).sort((a, b) => b.id - a.id)];
  if (sql.startsWith('SELECT') && sql.includes('FROM application WHERE `deleted_at`')) return [active().sort((a, b) => b.id - a.id)];
  return [[]];
};
let lock = Promise.resolve();
const getConnection = async () => {
  const previous = lock; let unlock; lock = new Promise(resolve => { unlock = resolve; }); let before, beforeEvents;
  return { execute, beginTransaction: async () => { await previous; before = [...applications.entries()].map(([id, row]) => [id, { ...row }]); beforeEvents = [...events]; },
    commit: async () => unlock(), rollback: async () => { applications = new Map(before); events = beforeEvents; unlock(); }, release() {} };
};
const replace = (name, exports) => { const file = require.resolve(name); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
replace('../config/database', { execute, getConnection });
for (const route of ['employees', 'auth', 'chat', 'knowledgeBase', 'networkMap', 'appSettings']) replace(`../routes/${route}`, express.Router());
replace('../routes/adminBackups', { router: express.Router(), backupGate: (req, res, next) => next(), maintenanceEvents: new EventEmitter(), maintenanceStatus: () => ({ active: false }) });
const { app } = require('../server');
const invoke = async (method, path, { body = {}, id = 1, login = 'alice', role = 'employee', key = '' } = {}) => {
  const route = app._router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  const req = { params: { id: String(id) }, body, query: {}, auth: { login, role }, get: () => key };
  const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await route.stack.at(-1).handle(req, res); return res;
};
const submit = (text, key) => invoke('post', '/api/applications/from-chat', { key, body: { application: text, category: 'Техника', priority: 'Обычный' } });
const cancel = (id, login = 'alice') => invoke('post', '/api/applications/:id/cancel', { id, login });
const list = () => invoke('get', '/api/applications/my');
const count = () => invoke('get', '/api/applications/unseen-count', { login: 'admin', role: 'admin' });
const accept = id => invoke('post', '/api/applications/:id/accept', { id, login: 'admin', role: 'admin', body: { executor: 'Администратор' } });
const reopen = (id, comment) => invoke('post', '/api/applications/:id/reopen', { id, body: { employee_comment: comment } });
test.beforeEach(() => { applications.clear(); events = []; nextId = 1; lock = Promise.resolve(); failCancellationEvent = false; });

test('three separate submissions create distinct requests; cancelling one leaves the other two and decreases the admin count', async () => {
  const created = await Promise.all([submit('Принтер', 'one'), submit('Сеть', 'two'), submit('Компьютер', 'three')]);
  assert.ok(created.every(result => result.statusCode === 201)); assert.deepEqual(created.map(result => result.body.id), [1, 2, 3]);
  assert.equal((await count()).body.count, 3);
  assert.equal((await cancel(2)).statusCode, 200);
  assert.deepEqual((await list()).body.applications.map(row => row.id), [3, 1]);
  assert.equal((await count()).body.count, 2);
  assert.deepEqual((await invoke('get', '/api/applications', { login: 'admin', role: 'admin' })).body.applications.map(row => row.id), [3, 1]);
});
test('two reopened requests retain their own IDs, comments and accumulated work; both return to the admin queue', async () => {
  await submit('Первый', 'first'); await submit('Второй', 'second'); await accept(1); await accept(2);
  applications.get(1).work_seconds = 600; applications.get(2).work_seconds = 900;
  const results = await Promise.all([reopen(1, 'Принтер всё ещё не работает'), reopen(2, 'Сеть всё ещё пропадает')]);
  assert.ok(results.every(result => result.statusCode === 200));
  assert.equal(applications.size, 2); assert.equal(applications.get(1).status, 'reopened'); assert.equal(applications.get(2).status, 'reopened');
  assert.equal(applications.get(1).employee_comment, 'Принтер всё ещё не работает'); assert.equal(applications.get(2).employee_comment, 'Сеть всё ещё пропадает');
  assert.ok(applications.get(1).work_seconds >= 600); assert.ok(applications.get(2).work_seconds >= 900);
  assert.equal(JSON.parse(applications.get(1).work_cycles_json).length, 1);
  assert.equal((await count()).body.count, 2);
  await reopen(1, 'Ещё один комментарий');
  assert.equal(applications.get(1).employee_comment, 'Принтер всё ещё не работает');
  await accept(2); assert.equal(JSON.parse(applications.get(2).work_cycles_json).length, 2);
  await reopen(2, 'После повторной работы сеть пропадает');
  await cancel(1); assert.equal((await list()).body.applications[0].id, 2); assert.equal((await count()).body.count, 1);
});
test('cancellation and completion are serialized and cannot restore a deleted request', async () => {
  const done = id => invoke('post', '/api/applications/:id/confirm', { id });
  await submit('Отменить', 'cancel-first'); await accept(1);
  const [cancelled, tooLate] = await Promise.all([cancel(1), done(1)]);
  assert.equal(cancelled.statusCode, 200); assert.equal(tooLate.statusCode, 404); assert.equal((await list()).body.applications.length, 0);
  await submit('Закрыть', 'done-first'); await accept(2);
  const [completed, rejected] = await Promise.all([done(2), cancel(2)]);
  assert.equal(completed.statusCode, 200); assert.equal(rejected.statusCode, 409);
  assert.equal(applications.get(2).deleted_at, null); assert.equal(applications.get(2).status, 'done');
});
test('a database failure rolls back cancellation and allows a safe retry', async context => {
  context.mock.method(console, 'error', () => {});
  await submit('Повторить отмену', 'rollback'); failCancellationEvent = true;
  assert.equal((await cancel(1)).statusCode, 500); assert.equal(applications.get(1).deleted_at, null); assert.equal(applications.get(1).revision, 0);
  failCancellationEvent = false; assert.equal((await cancel(1)).statusCode, 200); assert.equal((await list()).body.applications.length, 0);
});
test('cancel enforces owner, source and active status and repeated attempts perform one deletion', async () => {
  await submit('Не нужна', 'cancel');
  assert.equal((await cancel(1, 'bob')).statusCode, 403); assert.equal(applications.get(1).deleted_at, null);
  applications.get(1).source = 'admin'; assert.equal((await cancel(1)).statusCode, 403); applications.get(1).source = 'chat';
  applications.get(1).status = 'done'; applications.get(1).fl = 1; assert.equal((await cancel(1)).statusCode, 409);
  applications.get(1).status = 'new'; applications.get(1).fl = 0;
  await Promise.all([cancel(1), cancel(1)]);
  assert.equal(events.filter(event => event.type === 'cancelled_by_employee').length, 1); assert.equal(applications.get(1).revision, 1);
  assert.equal((await list()).body.applications.length, 0); assert.equal((await accept(1)).statusCode, 404);
  assert.equal((await cancel('1oops')).statusCode, 400);
});
test('same creation operation is replayed without a duplicate; a separate key creates another request even with equal text', async () => {
  await submit('Одна проблема', 'operation'); await submit('Одна проблема', 'operation');
  assert.equal(applications.size, 1); await submit('Одна проблема', 'new-operation'); assert.equal(applications.size, 2);
});
test('cancellation emits a deleted event to employee and admin streams but not a colleague', async () => {
  const route = app._router.stack.find(layer => layer.route?.path === '/api/applications/stream').route;
  const clients = ['alice', 'admin', 'bob'].map(login => {
    const req = new EventEmitter(); req.auth = { login, role: login === 'admin' ? 'admin' : 'employee', expiresAt: Date.now() + 3600000 };
    const res = new EventEmitter(); res.data = []; res.status = () => res; res.set = () => res; res.write = value => res.data.push(value); res.end = () => res.emit('close');
    route.stack.at(-1).handle(req, res); return { req, res };
  });
  try {
    await submit('Удалить', 'delete-event'); await cancel(1);
    for (const client of clients.slice(0, 2)) assert.ok(client.res.data.some(text => text.includes('"eventType":"deleted"') && text.includes('"id":1')));
    assert.equal(clients[2].res.data.some(text => text.includes('"eventType":"deleted"')), false);
  } finally { clients.forEach(({ req, res }) => { req.emit('close'); res.emit('close'); }); }
});
