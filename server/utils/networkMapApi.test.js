const test = require('node:test');
const assert = require('node:assert/strict');
require('express');
require('./networkMapChanges');
let saved, writes, sourceCalls, nextText;
const pool = { execute: async (sql, params = []) => {
  if (sql.includes('CREATE TABLE')) return [[]];
  if (sql.startsWith('SELECT source_url')) return [saved ? [{ ...saved }] : []];
  if (sql.includes('INSERT INTO network_map_snapshot')) {
    writes++; saved = { source_url: params[0], zone_text: params[1], fetched_at: params[2] }; return [{}];
  }
  throw new Error(sql);
} };
const file = require.resolve('../config/database');
require.cache[file] = { id: file, filename: file, loaded: true, exports: pool };
require('../middleware/auth');
const routeFile = require.resolve('../routes/networkMap');
let router;
const originalFetch = global.fetch;
const load = () => { delete require.cache[routeFile]; return require(routeFile); };
const invoke = async (method, headers = {}, role = 'admin') => {
  const route = router.stack.find((layer) => layer.route?.methods[method]).route;
  const req = { headers, auth: { role } };
  const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    set(key, value) { this.headers[key] = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  for (const layer of route.stack) {
    let proceed = false;
    await layer.handle(req, res, () => { proceed = true; });
    if (!proceed) break;
  }
  return res;
};
test.beforeEach((t) => {
  saved = { source_url: 'source', zone_text: '; Lab\na A 10.1.1.2\nb A 10.1.1.3', fetched_at: new Date('2020-01-01') };
  writes = 0; sourceCalls = 0; nextText = saved.zone_text;
  global.fetch = async () => { sourceCalls++; return { ok: true, text: async () => nextText }; };
  t.mock.method(console, 'error', () => {});
  router = load();
});
test.after(() => { global.fetch = originalFetch; });

test('import and restart schedule no timers and make no external calls', () => {
  const timeout = global.setTimeout, interval = global.setInterval;
  let timers = 0;
  try {
    global.setTimeout = global.setInterval = () => { timers++; return { unref() {} }; };
    router = load(); router = load();
  } finally { global.setTimeout = timeout; global.setInterval = interval; }
  assert.equal(timers, 0); assert.equal(sourceCalls, 0); assert.equal(writes, 0);
});
test('GET serves even an old SQL snapshot without refreshing it; restart preserves it', async () => {
  const old = { ...saved };
  assert.equal((await invoke('get')).body.zoneText, old.zone_text);
  router = load(); await invoke('get');
  assert.equal(sourceCalls, 0); assert.equal(writes, 0); assert.deepEqual(saved, old);
});
test('an empty database asks for a manual update without calling the external source', async () => {
  saved = null;
  const response = await invoke('get');
  assert.equal(response.statusCode, 404); assert.match(response.body.error, /настройках/);
  assert.equal(sourceCalls, 0); assert.equal(writes, 0);
});
test('manual refresh saves the source once and reports added, removed and changed IPs', async () => {
  nextText = '; Lab\nnew-host A 10.1.1.2\nc A 10.1.1.4';
  const result = await invoke('post');
  assert.equal(result.statusCode, 200); assert.equal(sourceCalls, 1); assert.equal(writes, 1);
  const changes = result.body.changes;
  assert.equal(changes.added.count, 1); assert.equal(changes.removed.count, 1); assert.equal(changes.updated.count, 1);
  assert.equal(saved.zone_text, nextText);
  const repeat = await invoke('post');
  assert.equal(repeat.body.changes.added.count + repeat.body.changes.removed.count + repeat.body.changes.updated.count, 0);
});
test('first manual import is marked separately, followed by a stored-only GET', async () => {
  saved = null;
  const result = await invoke('post');
  assert.equal(result.body.changes.initialLoad, true); assert.equal(result.body.changes.total, 2);
  const stored = await invoke('get'); assert.equal(stored.body.zoneText, nextText);
  assert.equal(sourceCalls, 1);
});
test('employees cannot refresh the network snapshot', async () => {
  const response = await invoke('post', {}, 'employee');
  assert.equal(response.statusCode, 403); assert.equal(sourceCalls, 0); assert.equal(writes, 0);
});
test('failed and malformed downloads preserve the previous snapshot', async () => {
  const old = { ...saved };
  nextText = '<html>source unavailable</html>';
  assert.equal((await invoke('post')).statusCode, 422); assert.deepEqual(saved, old); assert.equal(writes, 0);
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal((await invoke('post')).statusCode, 500); assert.deepEqual(saved, old);
  global.fetch = async () => ({ ok: true, text: async () => '; Lab\nnew A 10.1.1.6' });
  assert.equal((await invoke('post')).statusCode, 200); assert.equal(writes, 1);
});
test('ETag changes with content even when update timestamps match; revalidation does not fetch', async () => {
  const first = await invoke('get');
  const etag = first.headers.ETag;
  assert.equal((await invoke('get', { 'if-none-match': etag })).statusCode, 304);
  saved.zone_text = '; Lab\nchanged A 10.1.1.2';
  assert.equal((await invoke('get', { 'if-none-match': etag })).statusCode, 200);
  assert.equal(sourceCalls, 0);
});
