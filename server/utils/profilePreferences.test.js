const test = require('node:test');
const assert = require('node:assert/strict');
const profiles = {
  alice: { bio: 'Сохранить анкету', preferences: { uiLanguage: 'ru', uiTheme: 'dark', requestCardDesign: 'legacy' } },
  bob: { preferences: { uiLanguage: 'en', uiDensity: 'regular' } }
};
const dbPath = require.resolve('../config/database');
const execute = async (sql, args = []) => {
  if (/^(CREATE|ALTER|SHOW)/.test(sql.trim())) return [[]];
  if (/SELECT .* FROM employee_profiles/.test(sql)) return [Object.entries(profiles).filter(([login]) => !args.length || login === args[0]).map(([login, profile]) => ({ login, profile_json: JSON.stringify(profile) }))];
  if (/INSERT INTO employee_profiles/.test(sql)) { profiles[args[0]] = JSON.parse(args[1]); return [{ affectedRows: 1 }]; }
  throw new Error(`Unexpected SQL: ${sql}`);
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { execute, query: execute } };
const router = require('../routes/auth');
const handler = router.stack.find((layer) => layer.route?.path === '/profile/preferences').route.stack.at(-1).handle;
const update = async (login, preferences, forgedLogin) => {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ auth: { login }, body: { preferences, login: forgedLogin } }, res);
  assert.notEqual(res.code, 500, JSON.stringify(res.body)); return res;
};

test('SQL saves use the authenticated account and merge partial admin/chat preferences without deleting other settings', async () => {
  await update('alice', { auditTestMode: true, loginDesign: 'service', adminTheme: 'light', showEditApplicationTable: true }, 'bob');
  assert.deepEqual(profiles.bob.preferences, { uiLanguage: 'en', uiDensity: 'regular' });
  assert.equal(profiles.alice.bio, 'Сохранить анкету');
  assert.equal(profiles.alice.preferences.uiLanguage, 'ru');
  await Promise.all([update('alice', { uiTextSize: 'large' }), update('alice', { requestViewMode: 'table' }), update('bob', { uiLanguage: 'ru' })]);
  assert.equal(profiles.alice.preferences.uiTextSize, 'large');
  assert.equal(profiles.alice.preferences.requestViewMode, 'table');
  assert.equal(profiles.alice.preferences.requestCardDesign, 'legacy');
  assert.equal(profiles.bob.preferences.uiLanguage, 'ru');
  await update('alice', { uiLanguage: 'invalid', adminTheme: 'invalid', unexpected: 'ignored' });
  assert.equal(profiles.alice.preferences.uiLanguage, 'ru');
  assert.equal(profiles.alice.preferences.unexpected, undefined);
});
