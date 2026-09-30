const MIN_UPLOAD_MB = 50;
const MAX_UPLOAD_MB = 128;
const validateUploadLimit = (value) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_UPLOAD_MB || value > MAX_UPLOAD_MB) {
    throw Object.assign(new Error('Размер вложения должен быть целым числом от 50 до 128 МБ'), { status: 400 });
  }
  return value;
};

const createUploadSettingsStore = (db) => {
  let schemaPromise;
  const ensure = () => {
    if (!schemaPromise) schemaPromise = db.query(`CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(120) PRIMARY KEY,
      setting_value VARCHAR(255) NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((error) => { schemaPromise = null; throw error; });
    return schemaPromise;
  };
  return {
    async getLimitMb() {
      await ensure();
      const [rows] = await db.execute('SELECT setting_value FROM app_settings WHERE setting_key = ?', ['chat_upload_limit_mb']);
      const value = rows.length ? Number(rows[0].setting_value) : MIN_UPLOAD_MB;
      return Number.isInteger(value) && value >= MIN_UPLOAD_MB && value <= MAX_UPLOAD_MB ? value : MIN_UPLOAD_MB;
    },
    async saveLimitMb(value) {
      validateUploadLimit(value);
      await ensure();
      await db.execute('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP', ['chat_upload_limit_mb', String(value)]);
      return value;
    }
  };
};

module.exports = { MIN_UPLOAD_MB, MAX_UPLOAD_MB, validateUploadLimit, createUploadSettingsStore };
