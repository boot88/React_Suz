const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRequestValue,
  mergeProfileMaps
} = require('./profileState');

test('an explicit empty avatar clears the previous value', () => {
  assert.equal(getRequestValue({ avatar: '' }, 'avatar', 'old-avatar'), '');
  assert.equal(getRequestValue({}, 'avatar', 'old-avatar'), 'old-avatar');
});

test('newer durable profile data wins over a stale archive', () => {
  const profiles = mergeProfileMaps(
    { ivanov: { avatar: 'old', updatedAt: '2026-07-23T10:00:00.000Z' } },
    { ivanov: { avatar: 'new', updatedAt: '2026-07-23T10:01:00.000Z' } }
  );

  assert.equal(profiles.ivanov.avatar, 'new');
});

test('an archive profile remains available before its first SQL migration', () => {
  const profiles = mergeProfileMaps(
    { ivanov: { avatar: 'archive-avatar' } },
    {}
  );

  assert.equal(profiles.ivanov.avatar, 'archive-avatar');
});
