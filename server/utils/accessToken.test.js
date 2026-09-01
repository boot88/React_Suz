const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAccessToken,
  verifyAccessToken,
  createMediaToken,
  verifyMediaToken
} = require('./accessToken');

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

test('signs and verifies a short-lived media token bound to one file', () => {
  const token = createMediaToken({ fileId: 'file_123', scope: 'chat' });
  const media = verifyMediaToken(token);
  assert.equal(media.fileId, 'file_123');
  assert.equal(media.scope, 'chat');
  assert.ok(media.expiresAt > Date.now());
});

test('rejects a modified or expired media token', () => {
  const token = createMediaToken({ fileId: 'file_123' });
  assert.equal(verifyMediaToken(`${token}x`), null);

  // Access-токен не должен приниматься как media-токен и наоборот.
  const accessToken = createAccessToken({ login: 'employee.one' });
  assert.equal(verifyMediaToken(accessToken), null);
});
