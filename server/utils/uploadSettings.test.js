const test = require('node:test');
const assert = require('node:assert/strict');
const { createUploadSettingsStore, validateUploadLimit } = require('./uploadSettings');

test('default is 50 MB and saved values persist across store restarts', async () => {
  let saved;
  const db = { query: async () => [[]], execute: async (sql, values) => {
    if (sql.startsWith('SELECT')) return [saved === undefined ? [] : [{ setting_value: saved }]];
    saved = values[1]; return [{}];
  } };
  const store = createUploadSettingsStore(db);
  assert.equal(await store.getLimitMb(), 50);
  await store.saveLimitMb(128);
  assert.equal(await createUploadSettingsStore(db).getLimitMb(), 128);
  await store.saveLimitMb(73);
  assert.equal(await store.getLimitMb(), 73);
});

test('rejects invalid limits before writing and preserves the prior value', async () => {
  let writes = 0;
  const store = createUploadSettingsStore({ query: async () => [[]], execute: async () => { writes += 1; return [{}]; } });
  for (const value of [49, 129, -1, 50.5, null, '128', NaN, Infinity]) {
    await assert.rejects(store.saveLimitMb(value), (error) => error.status === 400);
  }
  assert.equal(writes, 0);
  assert.equal(validateUploadLimit(50), 50);
  assert.equal(validateUploadLimit(128), 128);
});

test('reads changes from SQL immediately, including restored settings', async () => {
  let value = '100';
  const store = createUploadSettingsStore({ query: async () => [[]], execute: async () => [[{ setting_value: value }]] });
  assert.equal(await store.getLimitMb(), 100);
  value = '64';
  assert.equal(await store.getLimitMb(), 64);
  value = '999';
  assert.equal(await store.getLimitMb(), 50);
});
