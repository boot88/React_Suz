const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$/;

const hashLegacySha256 = (value) => (
  `sha256$${crypto.createHash('sha256').update(String(value)).digest('hex')}`
);

const hashPassword = (value) => bcrypt.hash(String(value), BCRYPT_ROUNDS);

const verifyPassword = async (rawPassword, storedPassword = '') => {
  const stored = String(storedPassword || '');
  if (!stored) return false;
  if (BCRYPT_PATTERN.test(stored)) return bcrypt.compare(String(rawPassword), stored);
  if (stored.startsWith('sha256$')) return stored === hashLegacySha256(rawPassword);
  // Неизвестный формат хранения: не сравниваем с открытым паролем.
  return false;
};

const passwordNeedsUpgrade = (storedPassword = '') => !BCRYPT_PATTERN.test(String(storedPassword || ''));

module.exports = {
  BCRYPT_ROUNDS,
  hashLegacySha256,
  hashPassword,
  verifyPassword,
  passwordNeedsUpgrade
};
