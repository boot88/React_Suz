const crypto = require('crypto');
const { EventEmitter } = require('events');
const db = require('../config/database');
const { createAccessToken, verifyAccessToken } = require('./accessToken');

const changes = new EventEmitter();
changes.setMaxListeners(0);
let schema;
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const credentialStamp = (user) => digest(`${user.id}:${user.password}:${user.role}:${user.login}`);
const ensureSessions = () => {
  if (!schema) schema = db.execute(`CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL,
    credential_stamp CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    INDEX idx_auth_sessions_user (user_id),
    INDEX idx_auth_sessions_expiry (expires_at)
  )`).catch((error) => { schema = null; throw error; });
  return schema;
};

const issueSession = async (user) => {
  await ensureSessions();
  const token = createAccessToken({ login: user.login, role: user.role });
  const identity = verifyAccessToken(token);
  await db.execute('INSERT INTO auth_sessions (token_hash, user_id, credential_stamp, expires_at) VALUES (?, ?, ?, ?)',
    [digest(token), user.id, credentialStamp(user), new Date(identity.expiresAt)]);
  await db.execute('DELETE FROM auth_sessions WHERE expires_at < NOW()').catch(() => {});
  return token;
};

const resolveSession = async (token) => {
  const identity = verifyAccessToken(token);
  if (!identity) return null;
  await ensureSessions();
  const [rows] = await db.execute(`SELECT u.id, u.login, u.role, u.password, s.credential_stamp
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > NOW() LIMIT 1`, [digest(token)]);
  const user = rows[0];
  if (!user || user.credential_stamp !== credentialStamp(user)) return null;
  return { ...identity, login: String(user.login).toLowerCase(), role: user.role };
};

const revokeSession = async (token) => {
  await ensureSessions();
  await db.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [digest(token)]);
  changes.emit('changed');
};
const notifySessionChange = () => changes.emit('changed');

// Check both token expiry and account/password changes while an SSE response is open.
const guardSessionStream = (req, res) => {
  let checking = false;
  let closed = false;
  const check = async () => {
    if (checking || closed) return;
    checking = true;
    try { if (!await resolveSession(req.authToken)) res.end(); }
    catch { res.end(); }
    finally { checking = false; }
  };
  const interval = setInterval(check, 15000);
  const expiry = setTimeout(() => res.end(), Math.max(0, req.auth.expiresAt - Date.now()));
  const cleanup = () => {
    closed = true;
    clearInterval(interval);
    clearTimeout(expiry);
    changes.off('changed', check);
  };
  changes.on('changed', check);
  res.once('close', cleanup);
  return cleanup;
};

module.exports = { issueSession, resolveSession, revokeSession, notifySessionChange, guardSessionStream };
