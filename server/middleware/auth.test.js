const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccessToken, createMediaToken, verifyAccessToken } = require('../utils/accessToken');
// Middleware awaits persistent-session verification; mock only that service.
const sessionPath = require.resolve('../utils/authSessions');
require.cache[sessionPath] = { id: sessionPath, filename: sessionPath, loaded: true, exports: { resolveSession: async (token) => verifyAccessToken(token) } };
const {
  requireAuth,
  requireAuthAllowQuery,
  requireAuthAllowQueryOrMedia,
  requireRole,
  requireSelfOrRole
} = require('./auth');

const createResponse = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  }
});

const runMiddleware = async (middleware, req) => {
  const res = createResponse();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
};

test('requires a signed bearer token and rejects legacy login headers', async () => {
  const legacy = await runMiddleware(requireAuth, {
    headers: { 'x-user-login': 'ivanov' },
    query: { login: 'ivanov' }
  });
  assert.equal(legacy.res.statusCode, 401);
  assert.equal(legacy.nextCalled, false);

  const token = createAccessToken({ login: 'ivanov', role: 'employee' });
  const authenticated = await runMiddleware(requireAuth, {
    headers: { authorization: `Bearer ${token}` },
    query: {}
  });
  assert.equal(authenticated.nextCalled, true);
  assert.equal(authenticated.req.auth.login, 'ivanov');
});

test('allows query tokens only for streams and protected media', async () => {
  const token = createAccessToken({ login: 'ivanov', role: 'employee' });
  const standard = await runMiddleware(requireAuth, { headers: {}, query: { access_token: token } });
  const stream = await runMiddleware(requireAuthAllowQuery, { headers: {}, query: { access_token: token } });

  assert.equal(standard.res.statusCode, 401);
  assert.equal(stream.nextCalled, true);
});

test('allows a short-lived media token for file downloads', async () => {
  const mediaToken = createMediaToken({ fileId: 'file_123', scope: 'chat' });

  const viaMedia = await runMiddleware(requireAuthAllowQueryOrMedia, {
    headers: {},
    query: { mt: mediaToken }
  });
  assert.equal(viaMedia.nextCalled, true);
  assert.equal(viaMedia.req.mediaAuth.fileId, 'file_123');

  // Без токена — 401.
  const without = await runMiddleware(requireAuthAllowQueryOrMedia, {
    headers: {},
    query: {}
  });
  assert.equal(without.res.statusCode, 401);

  // Media-токен не даёт identity для обычных API-вызовов.
  const identity = await runMiddleware(requireAuthAllowQueryOrMedia, {
    headers: {},
    query: { mt: mediaToken }
  });
  assert.equal(identity.req.auth, undefined);
});

test('enforces roles and self ownership', async () => {
  const adminRole = await runMiddleware(requireRole('admin'), {
    auth: { login: 'admin', role: 'admin' }
  });
  const employeeRole = await runMiddleware(requireRole('admin'), {
    auth: { login: 'ivanov', role: 'employee' }
  });
  const ownProfile = await runMiddleware(
    requireSelfOrRole((req) => req.body.login, 'admin'),
    { auth: { login: 'ivanov', role: 'employee' }, body: { login: 'IVANOV' } }
  );
  const foreignProfile = await runMiddleware(
    requireSelfOrRole((req) => req.body.login, 'admin'),
    { auth: { login: 'ivanov', role: 'employee' }, body: { login: 'petrov' } }
  );

  assert.equal(adminRole.nextCalled, true);
  assert.equal(employeeRole.res.statusCode, 403);
  assert.equal(ownProfile.nextCalled, true);
  assert.equal(foreignProfile.res.statusCode, 403);
});

test('temporary administrator credentials allow only the password change and session/logout APIs', async () => {
  const token = createAccessToken({ login: 'new-admin', role: 'admin', mustChangePassword: true });
  for (const originalUrl of ['/api/applications', '/api/backups', '/api/applications/stream?access_token=x']) {
    const result = await runMiddleware(requireAuth, { originalUrl, headers: { authorization: `Bearer ${token}` } });
    assert.equal(result.res.statusCode, 403); assert.equal(result.res.payload.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal(result.nextCalled, false);
  }
  for (const originalUrl of ['/api/auth/change-password', '/api/auth/session', '/api/auth/logout']) {
    const result = await runMiddleware(requireAuth, { originalUrl, headers: { authorization: `Bearer ${token}` } });
    assert.equal(result.nextCalled, true);
  }
});
