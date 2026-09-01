const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hashLegacySha256,
  hashPassword,
  verifyPassword,
  passwordNeedsUpgrade
} = require('./password');

test('stores new passwords with salted bcrypt hashes', async () => {
  const first = await hashPassword('Secure password 2026');
  const second = await hashPassword('Secure password 2026');

  assert.match(first, /^\$2[aby]\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('Secure password 2026', first), true);
  assert.equal(await verifyPassword('wrong', first), false);
  assert.equal(passwordNeedsUpgrade(first), false);
});

test('accepts legacy hashes only so login can upgrade them', async () => {
  const sha256 = hashLegacySha256('legacy-password');
  assert.equal(await verifyPassword('legacy-password', sha256), true);
  assert.equal(passwordNeedsUpgrade(sha256), true);
  assert.equal(passwordNeedsUpgrade('legacy-password'), true);
});

test('never compares plaintext passwords from unknown storage formats', async () => {
  // Раньше неизвестный формат сравнивался с открытым паролем. Теперь такие
  // записи считаются невалидными — пользователь должен сбросить пароль.
  assert.equal(await verifyPassword('legacy-password', 'legacy-password'), false);
  assert.equal(await verifyPassword('anything', ''), false);
});
