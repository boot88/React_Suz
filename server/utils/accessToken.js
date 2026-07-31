const crypto = require('crypto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEVELOPMENT_SECRET = crypto.randomBytes(32).toString('hex');

const getSecret = () => {
  const configured = String(process.env.AUTH_TOKEN_SECRET || '');
  if (configured.length >= 32 && configured !== 'replace-with-a-long-random-secret') {
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_TOKEN_SECRET must be a unique random value of at least 32 characters in production');
  }
  return DEVELOPMENT_SECRET;
};

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');

const createAccessToken = ({ login, role = 'employee' } = {}) => {
  const normalizedLogin = String(login || '').trim().toLowerCase();
  if (!normalizedLogin) throw new Error('login is required for an access token');
  const now = Date.now();
  const payload = encode({
    login: normalizedLogin,
    role: String(role || 'employee').toLowerCase(),
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_MS
  });
  return `${payload}.${sign(payload)}`;
};

const verifyAccessToken = (token = '') => {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed?.login || Number(parsed.expiresAt || 0) <= Date.now()) return null;
    return {
      login: String(parsed.login).trim().toLowerCase(),
      role: String(parsed.role || 'employee').toLowerCase(),
      expiresAt: Number(parsed.expiresAt)
    };
  } catch {
    return null;
  }
};

module.exports = {
  createAccessToken,
  verifyAccessToken
};
