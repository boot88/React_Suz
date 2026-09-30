const test = require('node:test');
const assert = require('node:assert/strict');
const { createBroadcastStore, validateBroadcast } = require('./chatBroadcasts');

// Transactional test database: messages and recipients roll back together.
// Unknown SQL fails so a missing persistence step cannot silently pass.
const fixture = () => {
  let state = { batches: {}, recipients: {}, messages: {}, retained: [], reads: {} };
  let queue = Promise.resolve();
  const users = [{ login: 'ivanov', full_name: 'Иванов И.И.' }, { login: 'petrov', full_name: 'Петров П.П.' }];
  const execute = async (holder, sql, args = []) => {
    const data = holder.state || state;
    if (/CREATE TABLE/.test(sql)) return [{}];
    if (/INSERT INTO chat_broadcasts/.test(sql)) {
      data.batches[args[0]] ||= { id: args[0], sender_login: args[1], sender_name: args[2], body_json: args[3], request_sha256: args[4], created_at: new Date().toISOString() };
      return [{}];
    }
    if (/SELECT \* FROM chat_broadcasts/.test(sql)) return [[data.batches[args[0]]].filter((row) => row?.sender_login === args[1])];
    if (/FROM users/.test(sql)) {
      if (/ IN \(\?\)/.test(sql)) return [users.filter((user) => args[0].includes(user.login))];
      if (/LOWER\(login\) =/.test(sql)) return [users.filter((user) => user.login === args[0])];
      return [users];
    }
    if (/INSERT INTO chat_broadcast_recipients/.test(sql)) {
      const row = { broadcast_id: args[0], recipient_login: args[1], recipient_name: args[2], conversation_id: args[3], message_id: args[4], status: 'pending', error_text: null, read_at: null };
      data.recipients[`${args[0]}:${args[1]}`] = row; return [{}];
    }
    if (/SELECT .* FROM chat_broadcast_recipients/.test(sql)) {
      let rows = Object.values(data.recipients).filter((row) => row.broadcast_id === args[0]);
      if (/status <>/.test(sql)) rows = rows.filter((row) => row.status !== args[1]);
      else if (/recipient_login =/.test(sql)) rows = rows.filter((row) => row.recipient_login === args[1]);
      return [rows];
    }
    if (/FROM chat_conversations/.test(sql)) return [[]];
    if (/UPDATE chat_files/.test(sql)) { data.retained.push(...args[0]); return [{}]; }
    if (/UPDATE chat_broadcast_recipients AS r/.test(sql)) {
      for (const row of Object.values(data.recipients)) {
        const relevant = /WHERE b.sender_login/.test(sql) ? data.batches[row.broadcast_id].sender_login === args[0] : row.recipient_login === args[0] && (!args[1] || row.conversation_id === args[1]);
        const cursor = data.reads[row.recipient_login];
        const message = data.messages[row.message_id];
        if (relevant && row.status === 'delivered' && cursor && message && (cursor.date > message.createdAt || (cursor.date === message.createdAt && cursor.id >= message.id))) row.read_at ||= new Date().toISOString();
      }
      return [{}];
    }
    if (/UPDATE chat_broadcast_recipients SET status = 'delivered'/.test(sql)) { Object.assign(data.recipients[`${args[0]}:${args[1]}`], { status: 'delivered', error_text: null }); return [{}]; }
    if (/UPDATE chat_broadcast_recipients SET status = 'failed'/.test(sql)) {
      const row = data.recipients[`${args[1]}:${args[2]}`];
      if (row.status !== 'delivered') Object.assign(row, { status: 'failed', error_text: args[0] });
      return [{}];
    }
    if (/SELECT b.id, b.body_json/.test(sql)) return [Object.values(data.batches).filter((batch) => batch.sender_login === args[0]).map((batch) => {
      const rows = Object.values(data.recipients).filter((row) => row.broadcast_id === batch.id);
      return { ...batch, total: rows.length, delivered: rows.filter((row) => row.status === 'delivered').length, read_count: rows.filter((row) => row.read_at).length };
    })];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const db = { execute: (sql, args) => execute({}, sql, args), query: (sql, args) => execute({}, sql, args),
    async getConnection() {
      const connection = { async beginTransaction() {
        const prior = queue; queue = new Promise((resolve) => { connection.unlock = resolve; }); await prior;
        connection.state = JSON.parse(JSON.stringify(state));
      }, async commit() { state = connection.state; delete connection.state; connection.unlock(); },
      async rollback() { if (connection.state) { delete connection.state; connection.unlock(); } }, release() {},
      execute: (sql, args) => execute(connection, sql, args), query: (sql, args) => execute(connection, sql, args) };
      return connection;
    }
  };
  let failing = '';
  const events = [];
  const store = createBroadcastStore({ db, deliver: async (connection, conversation, message) => {
    connection.state.messages[message.id] ||= { ...message, conversation };
    if (conversation.endsWith(failing) && failing) throw new Error('Simulated SQL failure after writing a message');
    return connection.state.messages[message.id];
  }, onDelivered: (conversation, message) => events.push({ conversation, message }) });
  return { store, db, events, users, state: () => state, fail: (login) => { failing = login; } };
};
const actor = { login: 'admin', name: 'Администратор' };
const command = { id: 'test-broadcast', text: 'Объявление', recipients: ['ivanov', 'petrov'], attachments: [{ id: 'file-1', name: 'spectrum.spc' }] };

test('partial failures roll back messages and retry delivers only missing private copies', async () => {
  const f = fixture(); f.fail('petrov');
  const first = await f.store.create(command, actor);
  assert.equal(first.delivered, 1); assert.equal(first.total, 2);
  assert.equal(Object.keys(f.state().messages).length, 1);
  assert.equal(first.recipients.find((row) => row.login === 'petrov').status, 'failed');
  assert.deepEqual(f.state().retained, ['file-1']);
  f.fail('');
  const retried = await f.store.send(command.id, actor.login);
  assert.equal(retried.delivered, 2); assert.equal(f.events.length, 2);
  assert.equal(Object.keys(f.state().messages).length, 2);
  for (const message of Object.values(f.state().messages)) {
    assert.equal(message.sender, 'admin'); assert.deepEqual(message.broadcast, { id: command.id });
    assert.equal(message.attachments[0].name, 'spectrum.spc'); assert.equal(message.recipients, undefined);
    assert.match(message.conversation, /^admin::(ivanov|petrov)$/);
  }
  await f.store.create(command, actor);
  assert.equal(f.events.length, 2, 'a lost HTTP response must not send duplicates');
});

test('concurrent submissions are idempotent and history is private to its sender', async () => {
  const f = fixture();
  await Promise.all([f.store.create(command, actor), f.store.create(command, actor)]);
  assert.equal(Object.keys(f.state().messages).length, 2); assert.equal(f.events.length, 2);
  await assert.rejects(f.store.create({ ...command, text: 'Changed message' }, actor), (error) => error.status === 409);
  await assert.rejects(f.store.detail(command.id, 'other-admin'), (error) => error.status === 404);
  await assert.rejects(f.store.send(command.id, 'other-admin'), (error) => error.status === 404);
  assert.equal((await f.store.list('other-admin')).items.length, 0);
});

test('recipient validation rolls back the batch and only recipient read cursors count', async () => {
  const f = fixture();
  await assert.rejects(f.store.create({ ...command, recipients: ['missing-user'] }, actor));
  assert.equal(Object.keys(f.state().batches).length, 0);
  await f.store.create({ ...command, recipients: ['IVANOV', 'ivanov', 'petrov'] }, actor);
  const message = Object.values(f.state().messages).find((row) => row.conversation === 'admin::ivanov');
  f.state().reads.admin = { date: message.createdAt, id: message.id };
  assert.equal((await f.store.detail(command.id, actor.login)).read, 0);
  f.state().reads.ivanov = { date: message.createdAt, id: message.id };
  await f.store.recordRead('ivanov', message.conversation);
  assert.equal((await f.store.detail(command.id, actor.login)).read, 1);
  delete f.state().messages[message.id];
  assert.equal((await f.store.detail(command.id, actor.login)).read, 1, 'read status survives later deletion');
});

test('rejects empty broadcasts, oversized text and malformed recipients before persistence', () => {
  for (const overrides of [{ text: '', attachments: [] }, { text: 'a'.repeat(2001) }, { recipients: [] }, { recipients: ['admin::employee'] }, { recipients: [null] }, { id: '../../bad' }]) {
    assert.throws(() => validateBroadcast({ ...command, ...overrides }));
  }
});

test('the actual chat router rejects non-admin broadcast access', () => {
  const dbPath = require.resolve('../config/database');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => [[]], execute: async () => [[]] } };
  const router = require('../routes/chat');
  const guard = router.stack.find((layer) => !layer.route && layer.regexp.test('/broadcasts') && layer.name !== 'router' && layer.regexp.toString().includes('broadcasts')).handle;
  for (const role of ['employee', 'manager']) {
    const res = { status(code) { this.code = code; return this; }, json() {} };
    guard({ auth: { role } }, res, () => assert.fail('Non-admin was allowed'));
    assert.equal(res.code, 403);
  }
  let allowed = false; guard({ auth: { role: 'admin' } }, {}, () => { allowed = true; }); assert.equal(allowed, true);
});
