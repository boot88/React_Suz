const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatisticsRouter, matches, options } = require('../routes/applicationStatistics');
const invoke = async (pool, path, query) => {
  const router = createStatisticsRouter(pool);
  const handler = router.stack.find((layer) => layer.route.path === path).route.stack[0].handle;
  const result = { status: 200 };
  const res = { status(value) { result.status = value; return this; }, json(value) { result.body = value; return this; } };
  await handler({ query }, res);
  return result;
};
test('executor selection matches exact teams and rejects invalid filters', () => {
  assert.equal(matches('Повисок Е.В. Андреев Р.В.', ['Повисок Е.В.']), false);
  assert.equal(matches('Повисок Е.В. Андреев Р.В.', ['Повисок Е.В.', 'Андреев Р.В.']), true);
  assert.equal(matches('П.Е.', ['Повисок Е.В.']), true);
  for (const query of [{ days: '0' }, { days: 'Infinity' }, { executors: '["unknown"]' }, { executors: '{}' }]) assert.throws(() => options(query));
});
test('summary returns grouped counts, equal windows and exact executor totals without request payloads', async () => {
  const calls = [];
  const pool = { async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT MIN')) return [[{ earliest: '2026-01-01T00:00:00Z' }]];
    if (sql.includes('GROUP BY day')) return [[{ day: '2026-10-01', executor: 'Повисок Е.В.', status: 'new', count: 3 }]];
    return [[{ executor: 'Повисок Е.В.', received_0: 3, closed_0: 2, opening_0: 4, remaining_0: 5, received_1: 1, closed_1: 1, opening_1: 4, remaining_1: 4, excluded: 1 }, { executor: 'Повисок Е.В. Андреев Р.В.', received_0: 99, remaining_0: 99 }]];
  } };
  const { status, body } = await invoke(pool, '/', { days: '7', executors: '["Повисок Е.В."]' });
  assert.equal(status, 200);
  assert.equal(body.comparison.current.received, 3);
  assert.equal(body.comparison.previous.received, 1);
  assert.equal(calls.length, 3);
  assert.equal(body.comparison.current.change, 1);
  assert.equal(body.comparison.excluded, 1);
  assert.equal(body.comparison.previous.to, body.comparison.current.from);
  assert.equal(body.comparison.current.to - body.comparison.current.from, 7 * 86400000);
  assert.equal(body.applications, undefined);
  assert.ok(calls.every(({ sql }) => !sql.includes('SELECT *')));
  assert.ok(calls[1].sql.includes('created >= ?'));
  assert.ok(calls[2].sql.includes('closed >= created'));
});
test('day detail is bounded, paginated and excludes executors outside the selected team', async () => {
  const calls = [];
  const pool = { async execute(sql, params) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT DISTINCT')) return [[{ executor: 'Повисок Е.В.' }, { executor: 'Андреев Р.В.' }]];
    return [Array.from({ length: 101 }, (_, id) => ({ id, application: `Request ${id}` }))];
  } };
  const result = await invoke(pool, '/day', { day: '2026-09-01', days: 'all', executors: '["Повисок Е.В."]', offset: '100' });
  assert.equal(result.status, 200);
  assert.equal(result.body.applications.length, 100);
  assert.equal(result.body.hasMore, true);
  assert.ok(calls[1].sql.includes('LIMIT 101 OFFSET 100'));
  assert.deepEqual(calls[1].params.slice(2), ['Повисок Е.В.']);
  const bad = await invoke(pool, '/day', { day: '2026-02-31' });
  assert.equal(bad.status, 400);
});
