const crypto = require('crypto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_TOKEN_TTL_MS = 10 * 60 * 1000;
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

// Короткоживущий подписанный токен для скачивания конкретного файла.
// Позволяет не помещать полный access_token в query-строку (история браузера,
// рефереры, логи). Токен действителен MEDIA_TOKEN_TTL_MS (10 минут) и привязан
// к одному fileId, поэтому его нельзя использовать для доступа к другим файлам.
const createMediaToken = ({ fileId = '', scope = '' } = {}) => {
  const normalizedFileId = String(fileId || '').trim();
  if (!normalizedFileId) throw new Error('fileId is required for a media token');
  const now = Date.now();
  const payload = encode({
    kind: 'media',
    fileId: normalizedFileId,
    scope: String(scope || '').trim(),
    issuedAt: now,
    expiresAt: now + MEDIA_TOKEN_TTL_MS
  });
  return `${payload}.${sign(payload)}`;
};

const verifyMediaToken = (token = '') => {
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
    if (parsed?.kind !== 'media' || !parsed?.fileId || Number(parsed.expiresAt || 0) <= Date.now()) return null;
    return {
      fileId: String(parsed.fileId),
      scope: String(parsed.scope || ''),
      expiresAt: Number(parsed.expiresAt)
    };
  } catch {
    return null;
  }
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
  verifyAccessToken,
  createMediaToken,
  verifyMediaToken,
  MEDIA_TOKEN_TTL_MS
};
