const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccessToken } = require('../utils/accessToken');
const {
  requireAuth,
  requireAuthAllowQuery,
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

const runMiddleware = (middleware, req) => {
  const res = createResponse();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
};

test('requires a signed bearer token and rejects legacy login headers', () => {
  const legacy = runMiddleware(requireAuth, {
    headers: { 'x-user-login': 'ivanov' },
    query: { login: 'ivanov' }
  });
  assert.equal(legacy.res.statusCode, 401);
  assert.equal(legacy.nextCalled, false);

  const token = createAccessToken({ login: 'ivanov', role: 'employee' });
  const authenticated = runMiddleware(requireAuth, {
    headers: { authorization: `Bearer ${token}` },
    query: {}
  });
  assert.equal(authenticated.nextCalled, true);
  assert.equal(authenticated.req.auth.login, 'ivanov');
});

test('allows query tokens only for streams and protected media', () => {
  const token = createAccessToken({ login: 'ivanov', role: 'employee' });
  const standard = runMiddleware(requireAuth, { headers: {}, query: { access_token: token } });
  const stream = runMiddleware(requireAuthAllowQuery, { headers: {}, query: { access_token: token } });

  assert.equal(standard.res.statusCode, 401);
  assert.equal(stream.nextCalled, true);
});

test('enforces roles and self ownership', () => {
  const adminRole = runMiddleware(requireRole('admin'), {
    auth: { login: 'admin', role: 'admin' }
  });
  const employeeRole = runMiddleware(requireRole('admin'), {
    auth: { login: 'ivanov', role: 'employee' }
  });
  const ownProfile = runMiddleware(
    requireSelfOrRole((req) => req.body.login, 'admin'),
    { auth: { login: 'ivanov', role: 'employee' }, body: { login: 'IVANOV' } }
  );
  const foreignProfile = runMiddleware(
    requireSelfOrRole((req) => req.body.login, 'admin'),
    { auth: { login: 'ivanov', role: 'employee' }, body: { login: 'petrov' } }
  );

  assert.equal(adminRole.nextCalled, true);
  assert.equal(employeeRole.res.statusCode, 403);
  assert.equal(ownProfile.nextCalled, true);
  assert.equal(foreignProfile.res.statusCode, 403);
});
