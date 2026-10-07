const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOrigin,
  readCorsOrigins,
  isAllowedCorsOrigin
} = require('./corsPolicy');

const production = { nodeEnv: 'production' };

test('requests without Origin header are not filtered', () => {
  assert.equal(isAllowedCorsOrigin(undefined, '192.168.129.31:3000', production), true);
  assert.equal(isAllowedCorsOrigin('', '192.168.129.31:3000', production), true);
});

test('the site itself is allowed in production: Origin matches the request Host', () => {
  assert.equal(isAllowedCorsOrigin('http://192.168.129.31:3000', '192.168.129.31:3000', production), true);
  assert.equal(isAllowedCorsOrigin('http://192.168.129.31:5000', '192.168.129.31:5000', production), true);
  assert.equal(isAllowedCorsOrigin('http://el-ap-sys:3000', 'el-ap-sys:3000', production), true);
  assert.equal(isAllowedCorsOrigin('http://zayavki.nioch.nsc.ru:3000', 'zayavki.nioch.nsc.ru:3000', production), true);
});

test('another port or another host of the same network is not the site itself', () => {
  assert.equal(isAllowedCorsOrigin('http://192.168.129.31:3000', '192.168.129.31:5000', production), false);
  assert.equal(isAllowedCorsOrigin('http://192.168.129.31:3000', '192.168.129.30:3000', production), false);
});

test('default ports are compared explicitly', () => {
  assert.equal(isAllowedCorsOrigin('http://hund03', 'hund03', production), true);
  assert.equal(isAllowedCorsOrigin('http://hund03:80', 'hund03', production), true);
  assert.equal(isAllowedCorsOrigin('https://hund03', 'hund03:443', production), true);
  assert.equal(isAllowedCorsOrigin('http://hund03', 'hund03:3000', production), false);
});

test('foreign origins are rejected in production', () => {
  assert.equal(isAllowedCorsOrigin('https://evil.example', '192.168.129.31:3000', production), false);
  assert.equal(isAllowedCorsOrigin('not a url', '192.168.129.31:3000', production), false);
});

test('the cloud address and the CORS_ORIGINS list are allowed in production', () => {
  const extraOrigins = readCorsOrigins(' http://192.168.129.31:3000 , https://friend.example ,,');
  assert.equal(isAllowedCorsOrigin('https://react-suz.onrender.com', '10.0.0.5:3000', production), true);
  assert.equal(isAllowedCorsOrigin('https://friend.example', '10.0.0.5:3000', { ...production, extraOrigins }), true);
  assert.equal(isAllowedCorsOrigin('http://other.example', '10.0.0.5:3000', { ...production, extraOrigins }), false);
});

test('development keeps the previous rule: localhost and private networks', () => {
  const development = { nodeEnv: 'development' };
  assert.equal(isAllowedCorsOrigin('http://localhost:3000', '127.0.0.1:5100', development), true);
  assert.equal(isAllowedCorsOrigin('http://192.168.1.35:3100', '127.0.0.1:5100', development), true);
  assert.equal(isAllowedCorsOrigin('http://10.1.2.3:3000', '127.0.0.1:5100', development), true);
  assert.equal(isAllowedCorsOrigin('http://172.20.0.9:3000', '127.0.0.1:5100', development), true);
  assert.equal(isAllowedCorsOrigin('http://172.40.0.9:3000', '127.0.0.1:5100', development), false);
  assert.equal(isAllowedCorsOrigin('https://evil.example', '127.0.0.1:5100', development), false);
});

test('the list of extra origins is parsed without empty values', () => {
  assert.deepEqual(readCorsOrigins(''), []);
  assert.deepEqual(readCorsOrigins('http://a.example:3000, b.example '), [
    { host: 'a.example', port: '3000' },
    { host: 'b.example', port: '' }
  ]);
});

test('origin parsing extracts host and port', () => {
  assert.deepEqual(parseOrigin('http://192.168.129.31:3000/admin'), { host: '192.168.129.31', port: '3000' });
  assert.deepEqual(parseOrigin('192.168.129.31:5000'), { host: '192.168.129.31', port: '5000' });
  assert.equal(parseOrigin(''), null);
});
