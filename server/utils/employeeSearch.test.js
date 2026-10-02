const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmployeeSearch } = require('./employeeSearch');

test('combines FIO, room or phone with an exact department and active records', () => {
  for (const field of ['full_name', 'room', 'internal_phone', 'external_phone']) {
    const result = buildEmployeeSearch({ field, query: ' 15 ', department: ' Отдел А ' });
    assert.equal(result.sql, `SELECT * FROM phone_book WHERE is_active = 1 AND ${field} LIKE ? AND department = ? ORDER BY full_name`);
    assert.deepEqual(result.params, ['%15%', 'Отдел А']);
  }
});
test('supports department only and preserves standalone search', () => {
  assert.deepEqual(buildEmployeeSearch({ field: 'full_name', department: 'Химия' }).params, ['Химия']);
  assert.equal(buildEmployeeSearch({ field: 'full_name', department: 'Химия' }).sql, 'SELECT * FROM phone_book WHERE is_active = 1 AND department = ? ORDER BY full_name');
  assert.deepEqual(buildEmployeeSearch({ field: 'email', query: 'a@b' }).params, ['%a@b%']);
});
test('rejects malformed queries and interpolates only allowlisted fields', () => {
  for (const input of [{ field: 'id OR 1=1', query: 'a' }, { field: 'room' }, { field: 'room', query: ['a'] }, { field: 'room', department: {} }]) {
    assert.ok(buildEmployeeSearch(input).error);
  }
  const result = buildEmployeeSearch({ field: 'room', query: "' OR 1=1 --", department: "' OR 1=1 --" });
  assert.ok(!result.sql.includes('OR 1=1'));
  assert.deepEqual(result.params, ["%' OR 1=1 --%", "' OR 1=1 --"]);
});
