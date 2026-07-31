const { verifyAccessToken } = require('../utils/accessToken');

const normalizeLogin = (value = '') => String(value || '').trim().toLowerCase();
const normalizeRole = (value = '') => String(value || 'employee').trim().toLowerCase();

const getBearerToken = (req) => {
  const authorization = String(req.headers?.authorization || '');
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
};

const getRequestToken = (req, { allowQuery = false } = {}) => (
  getBearerToken(req)
  || (allowQuery ? String(req.query?.access_token || '').trim() : '')
);

const authenticate = ({ allowQuery = false } = {}) => (req, res, next) => {
  const identity = verifyAccessToken(getRequestToken(req, { allowQuery }));
  if (!identity) {
    return res.status(401).json({ message: 'Требуется действующий токен авторизации' });
  }

  req.auth = {
    login: normalizeLogin(identity.login),
    role: normalizeRole(identity.role),
    expiresAt: identity.expiresAt
  };
  req.user = req.auth;
  return next();
};

const requireAuth = authenticate();
const requireAuthAllowQuery = authenticate({ allowQuery: true });

const requireRole = (...allowedRoles) => {
  const allowed = new Set(allowedRoles.flat().map(normalizeRole).filter(Boolean));
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ message: 'Требуется авторизация' });
    }
    if (!allowed.has(normalizeRole(req.auth.role))) {
      return res.status(403).json({ message: 'Недостаточно прав для выполнения операции' });
    }
    return next();
  };
};

const hasRole = (req, ...roles) => {
  const currentRole = normalizeRole(req.auth?.role);
  return roles.flat().map(normalizeRole).includes(currentRole);
};

const isSameLogin = (left, right) => (
  Boolean(normalizeLogin(left))
  && normalizeLogin(left) === normalizeLogin(right)
);

const requireSelfOrRole = (resolveLogin, ...roles) => (req, res, next) => {
  const targetLogin = typeof resolveLogin === 'function' ? resolveLogin(req) : resolveLogin;
  if (isSameLogin(req.auth?.login, targetLogin) || hasRole(req, roles)) {
    return next();
  }
  return res.status(403).json({ message: 'Нет доступа к данным другого пользователя' });
};

module.exports = {
  getBearerToken,
  getRequestToken,
  requireAuth,
  requireAuthAllowQuery,
  requireRole,
  requireSelfOrRole,
  hasRole,
  isSameLogin,
  normalizeLogin,
  normalizeRole
};
