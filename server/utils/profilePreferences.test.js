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

const welcomeHandler = router.stack.find((layer) => layer.route?.path === '/welcome').route.stack.at(-1).handle;
const visit = async (login) => {
  const res = { set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await welcomeHandler({ auth: { login }, body: { login: 'bob' } }, res);
  assert.notEqual(res.code, 500);
  return res.body;
};

test('daily greeting is persisted per authenticated account, across sessions and concurrent visits', async () => {
  const { getWelcomeDay } = require('./welcomeVisit');
  const day = getWelcomeDay();
  profiles.alice.lastWelcomeDay = '2000-01-01';
  delete profiles.bob.lastWelcomeDay;
  const visits = await Promise.all([visit('alice'), visit('alice')]);
  assert.deepEqual(visits.map((item) => item.returning), [false, true]);
  assert.equal(profiles.alice.lastWelcomeDay, day);
  assert.equal((await visit('bob')).returning, false);
  assert.equal((await visit('alice')).returning, true);
  assert.equal(profiles.alice.bio, 'Сохранить анкету');
  profiles.alice.lastWelcomeDay = '2000-01-01';
  assert.equal((await visit('alice')).returning, false);
});

test('daily greeting changes day at midnight in Novosibirsk, regardless of server timezone', () => {
  const { getWelcomeDay } = require('./welcomeVisit');
  assert.equal(getWelcomeDay(new Date('2026-09-30T16:59:59Z')), '2026-09-30');
  assert.equal(getWelcomeDay(new Date('2026-09-30T17:00:00Z')), '2026-10-01');
});
