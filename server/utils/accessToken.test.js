const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccessToken, verifyAccessToken } = require('./accessToken');

test('signs and verifies a scoped access token', () => {
  const token = createAccessToken({ login: 'Employee.One', role: 'employee' });
  const identity = verifyAccessToken(token);
  assert.equal(identity.login, 'employee.one');
  assert.equal(identity.role, 'employee');
  assert.ok(identity.expiresAt > Date.now());
});

test('rejects a modified access token', () => {
  const token = createAccessToken({ login: 'employee.one' });
  assert.equal(verifyAccessToken(`${token}x`), null);
});
