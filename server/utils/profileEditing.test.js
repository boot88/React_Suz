const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const path = require('node:path');
const { applyPersonalPatch } = require('./profileEditing');
const rows = { alice: { profile_json: JSON.stringify({ bio: 'Original', statusText: 'Work', preferences: { hidden: ['private-dialog'], uiDesign: 'classic' } }), avatar_stored_name: null } };
const queries = [];
const execute = async (sql, args = []) => {
  queries.push(sql);
  if (/^(CREATE|ALTER|SHOW)/.test(sql.trim())) return [[]];
  if (/SELECT .* FROM users/.test(sql)) return [[{ login: args[0], full_name: 'Alice', role: 'employee', position: 'Engineer' }]];
  if (/SELECT .* FROM employee_profiles/.test(sql)) return [[...(rows[args[0]] ? [{ ...rows[args[0]], login: args[0] }] : [])]];
  if (/INSERT IGNORE INTO employee_profiles/.test(sql)) { rows[args[0]] ||= { profile_json: args[1], avatar_stored_name: null }; return [{ affectedRows: 1 }]; }
  if (/SET profile_json/.test(sql)) {
    if (rows[args[2]].profile_json !== args[3]) return [{ affectedRows: 0 }];
    rows[args[2]].profile_json = args[0]; return [{ affectedRows: 1 }];
  }
  if (/SET avatar_stored_name/.test(sql)) {
    Object.assign(rows[args[3]], { avatar_stored_name: args[0], avatar_mime: args[1], avatar_size: args[2] });
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Unexpected SQL: ${sql}`);
};
let lock = Promise.resolve();
const getConnection = async () => {
  let unlock;
  const previous = lock; lock = new Promise(resolve => { unlock = resolve; });
  return { execute, beginTransaction: () => previous, commit: async () => unlock(), rollback: async () => unlock(), release() {} };
};
const dbPath = require.resolve('../config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { execute, query: execute, getConnection } };
const router = require('../routes/auth');
const handler = (url, method) => router.stack.find(layer => layer.route?.path === url && layer.route.methods[method]).route.stack.at(-1).handle;
const call = async (url, method, req) => {
  const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler(url, method)(req, res); return res;
};
const put = body => call('/profile', 'put', { auth: { login: 'alice' }, body });

test('personal fields validate types and limits, preserve punctuation, newlines and deliberate empty values', () => {
  const next = applyPersonalPatch({ bio: 'Before', statusText: 'Before' }, { bio: 'Путь C:\\Users\\file.txt\n"кавычки"', statusText: '', version: 0 });
  assert.equal(next.statusText, ''); assert.equal(next.bio, 'Путь C:\\Users\\file.txt\n"кавычки"');
  for (const body of [{ bio: null, version: 0 }, { statusText: 'a'.repeat(121), version: 0 }, { bio: 'a'.repeat(2001), version: 0 }, { full_name: 'Forged', version: 0 }, { bio: 'No version' }]) assert.throws(() => applyPersonalPatch({}, body), error => error.status === 400);
});

test('colleagues cannot receive personal preferences; owner can, and single-profile reads use a WHERE clause', async () => {
  queries.length = 0;
  const other = await call('/profile', 'get', { auth: { login: 'bob' }, query: { login: 'alice' } });
  assert.equal(other.code, 200); assert.equal('preferences' in other.body.profile, false);
  const own = await call('/profile', 'get', { auth: { login: 'alice' }, query: { login: 'alice' } });
  assert.deepEqual(own.body.profile.preferences.hidden, ['private-dialog']);
  assert.ok(queries.filter(sql => sql.includes('SELECT') && sql.includes('employee_profiles')).every(sql => sql.includes('WHERE login = ?')));
});

test('simultaneous stale tabs cannot overwrite each other, settings survive and stale response includes current values', async () => {
  const results = await Promise.all([put({ version: 0, bio: 'First' }), put({ version: 0, statusText: 'Second' })]);
  assert.deepEqual(results.map(result => result.code).sort(), [200, 409]);
  const conflict = results.find(result => result.code === 409);
  assert.equal(conflict.body.current.version, 1);
  const stored = JSON.parse(rows.alice.profile_json);
  assert.deepEqual(stored.preferences.hidden, ['private-dialog']);
  assert.equal(stored.profileVersion, 1);
});

test('photo upload, text and settings changes preserve each other; photo URL remains stable after unrelated changes', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64');
  const request = Readable.from([png]); request.auth = { login: 'alice' }; request.headers = { 'content-type': 'image/png' };
  const [photo, text, settings] = await Promise.all([
    call('/profile/avatar', 'post', request), put({ version: 1, bio: 'With photo' }),
    call('/profile/preferences', 'put', { auth: { login: 'alice' }, body: { preferences: { uiTheme: 'dark' } } })
  ]);
  assert.equal(photo.code, 200); assert.equal(text.code, 200); assert.equal(settings.code, 200);
  const stored = JSON.parse(rows.alice.profile_json);
  assert.equal(stored.bio, 'With photo'); assert.equal(stored.preferences.uiTheme, 'dark'); assert.equal(stored.preferences.uiDesign, 'classic');
  const own = () => call('/profile', 'get', { auth: { login: 'alice' }, query: { login: 'alice' } });
  const before = (await own()).body.profile.avatar;
  await call('/profile/preferences', 'put', { auth: { login: 'alice' }, body: { preferences: { uiTextSize: 'large' } } });
  assert.equal((await own()).body.profile.avatar, before);
  const storedName = rows.alice.avatar_stored_name;
  assert.ok(storedName);
  const deleted = await call('/profile/avatar', 'delete', { auth: { login: 'alice' } });
  assert.equal(deleted.code, 200); assert.equal((await own()).body.profile.avatar, '');
  await assert.rejects(fs.stat(path.join(__dirname, '../uploads/profile', storedName)), error => error.code === 'ENOENT');
  assert.equal(JSON.parse(rows.alice.profile_json).bio, 'With photo');
});

test('simultaneous avatar replacement and deletion leave a consistent pointer and do not change personal text', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64');
  const upload = () => { const request = Readable.from([png]); request.auth = { login: 'alice' }; request.headers = { 'content-type': 'image/png' }; return call('/profile/avatar', 'post', request); };
  const results = await Promise.all([upload(), upload(), call('/profile/avatar', 'delete', { auth: { login: 'alice' } })]);
  assert.ok(results.every(result => result.code === 200));
  if (rows.alice.avatar_stored_name) {
    const file = path.join(__dirname, '../uploads/profile', rows.alice.avatar_stored_name);
    assert.ok((await fs.stat(file)).size > 0);
  }
  assert.equal(JSON.parse(rows.alice.profile_json).bio, 'With photo');
  await call('/profile/avatar', 'delete', { auth: { login: 'alice' } });
  const remaining = (await fs.readdir(path.join(__dirname, '../uploads/profile'))).filter(name => name.startsWith('alice-'));
  assert.deepEqual(remaining, []);
});
