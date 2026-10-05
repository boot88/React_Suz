const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { applicationWorkSeconds } = require('../../src/utils/applicationDuration');
const { validateApplication } = require('../../src/utils/applicationValidation');
const { parseNetworkZone } = require('../../src/utils/networkZone');
const { dayBoundary, buildApplicationQuery } = require('./applicationQueries');
const { writeSqlBackup } = require('./adminBackupStream');
const { parseSql } = require('./adminBackup');
const { createCredentialStore } = require('./provisioningCredentials');

test('work and confirmation wait are counted once, including reopened cycles', () => {
  const app = { status: 'waiting_employee_confirmation', work_seconds: 600, work_started_at: '2026-10-01 00:00:00', resolved_at: '2026-10-01 00:10:00' };
  assert.equal(applicationWorkSeconds(app, Date.parse('2026-10-01T00:15:00Z')), 900);
  assert.equal(applicationWorkSeconds({ ...app, status: 'done', fl: 1, work_seconds: 900 }, Date.parse('2026-10-01T01:00:00Z')), 900);
  assert.equal(applicationWorkSeconds({ ...app, status: 'reopened', work_seconds: 900 }, Date.parse('2026-10-01T01:00:00Z')), 900);
  assert.equal(applicationWorkSeconds({ ...app, status: 'in_progress', work_started_at: '2026-10-01 01:00:00', work_seconds: 900 }, Date.parse('2026-10-01T01:05:00Z')), 1200);
});
test('calendar boundaries use Novosibirsk and an exclusive next-day bound', () => {
  assert.equal(dayBoundary('2026-10-01'), '2026-09-30 17:00:00');
  assert.equal(dayBoundary('2026-10-01', true), '2026-10-01 17:00:00');
  const query = buildApplicationQuery({ from: '2026-10-01', to: '2026-10-01' }, '0');
  assert.deepEqual(query.params, ['2026-09-30 17:00:00', '2026-10-01 17:00:00']);
  assert.match(query.whereSql, /created_at/); assert.match(query.whereSql, / < \?/);
  for (const day of ['2026-02-31', 'not-a-date', '2026-13-01']) assert.throws(() => dayBoundary(day));
  assert.throws(() => buildApplicationQuery({ from: '2026-10-02', to: '2026-10-01' }, '0'));
});
test('validation preserves technical plain text while rejecting invalid fields', () => {
  const values = { name: "О'Коннор Иван", cabinet: '15 / А', N_tel: '+7 (123)-45', application: 'Путь C:\\Temp\\"log" <ошибка> &quot;' };
  assert.deepEqual(validateApplication(values, { requireCabinet: true }), {});
  for (const changes of [{ N_tel: 'abc' }, { cabinet: 'x'.repeat(16) }, { executor: '123' }, { process: 'x'.repeat(1501) }, { application: '\x00' }]) assert.ok(Object.keys(validateApplication({ ...values, ...changes })).length);
});
test('network aliases use a single IP and unrecognized/invalid data create no subnet', () => {
  const groups = parseNetworkZone('; Серверы\na IN A 192.168.1.1\nb 3600 IN A 192.168.1.1\nc A 192.168.1.2\nbad IN A 192.168.999.1\nnetwork IN A 192.168.1.0');
  assert.equal(groups.length, 1); assert.equal(groups[0].occupied.length, 2);
  assert.equal(groups[0].freeIps.length, 252);
  assert.equal(groups[0].occupied[0].host, 'a, b');
  assert.equal(groups[0].occupied.length + groups[0].freeIps.length, 254);
  assert.deepEqual(parseNetworkZone('<html>failure</html>'), []);
});
test('streamed SQL preserves rows, NULL, metadata and checksum for the existing importer', async () => {
  const tables = [{ name: 'knowledge_base', schema: 'CREATE TABLE `knowledge_base` (`id` INT, `title` TEXT, `images` LONGTEXT) ENGINE=InnoDB', columns: ['id', 'title', 'images'] }];
  const backup = await writeSqlBackup('knowledge', tables, async function* () { for (let id = 0; id < 2500; id += 1) yield { id, title: `Текст "${id}" C:\\Temp`, images: null }; });
  try {
    const decoded = parseSql(await fs.readFile(backup.file, 'utf8'), 'knowledge', ['knowledge_base']);
    assert.equal(decoded[0].rows.length, 2500); assert.equal(decoded[0].rows[2499][1], 'Текст "2499" C:\\Temp');
    assert.equal(decoded[0].rows[0][2], null);
    assert.equal((await fs.stat(backup.file)).mode & 0o777, 0o600);
  } finally { await backup.cleanup(); }
});
test('pending credentials update atomically, serialize concurrent changes and disappear when used', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'suz-credentials-'));
  const file = path.join(directory, 'credentials.json'), store = createCredentialStore(file);
  try {
    await Promise.all(['first', 'second'].map((login) => store.update((entries) => [...entries, { login, password: 'temporary-test-password' }])));
    const entries = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(entries.map((entry) => entry.login), ['first', 'second']);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await store.update(() => []); await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
