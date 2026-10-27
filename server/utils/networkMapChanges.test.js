const test = require('node:test');
const assert = require('node:assert/strict');
const { compareNetworkSnapshots } = require('./networkMapChanges');

test('first import lists IPs once even when they have multiple DNS names', () => {
  const result = compareNetworkSnapshots('', '; Lab\na IN A 10.1.1.2\nb IN A 10.1.1.2\nc IN A 10.1.1.3', { initialLoad: true });
  assert.equal(result.initialLoad, true); assert.equal(result.total, 2);
  assert.equal(result.added.count, 2); assert.deepEqual(result.added.items[0].hosts, ['a', 'b']);
});
test('compares added, removed, changed hosts and section names by IP', () => {
  const result = compareNetworkSnapshots('; Lab\na A 10.1.1.2\nb A 10.1.1.3\nc A 10.1.1.4', '; New Lab\na A 10.1.1.2\nnew-host A 10.1.1.4\nd A 10.1.1.5');
  assert.deepEqual(result.added.items.map((row) => row.ip), ['10.1.1.5']);
  assert.deepEqual(result.removed.items.map((row) => row.ip), ['10.1.1.3']);
  assert.equal(result.updated.count, 2);
  assert.deepEqual(result.updated.items[1].before.hosts, ['c']);
  assert.deepEqual(result.updated.items[1].after.hosts, ['new-host']);
});
test('reordering, aliases, host casing, TTLs and duplicate lines produce no changes', () => {
  const result = compareNetworkSnapshots('; Lab\nA 3600 IN A 10.1.1.2\nb A 10.1.1.2\nc A 10.1.1.3', '; Lab\nc IN A 10.1.1.3\nb A 10.1.1.2\na. 100 IN A 10.1.1.2\na. 100 IN A 10.1.1.2');
  assert.equal(result.added.count + result.removed.count + result.updated.count, 0);
});
test('limits the preview without losing exact counts, and sorts IPs numerically', () => {
  const result = compareNetworkSnapshots('', 'a A 10.1.1.20\nb A 10.1.1.3\nc A 10.1.1.2', { previewLimit: 1 });
  assert.equal(result.added.count, 3); assert.equal(result.added.items.length, 1);
  assert.equal(result.added.items[0].ip, '10.1.1.2');
});
