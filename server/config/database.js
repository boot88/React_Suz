const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const LOCAL_ENV_KEYS = new Set([
  'AUTH_TOKEN_SECRET',
  'DEFAULT_EMPLOYEE_PASSWORD',
  'DEFAULT_ADMIN_PASSWORD',
  'MANAGER_LOGIN',
  'MANAGER_PASSWORD',
  'MANAGER_NAME',
  'PORT',
  'CLIENT_PORT',
  'NODE_ENV'
]);

const loadLocalServerEnv = () => {
  const envFile = process.env.MYSQL_ENV_FILE || path.resolve(__dirname, '../../.env');
  let source = '';

  try {
    source = fs.readFileSync(envFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not read local MySQL environment file: ${error.message}`);
    }
    return;
  }

  source.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) return;

    const [, key, rawValue] = match;
    const isAllowedKey = /^(MYSQL|DB)_/.test(key) || LOCAL_ENV_KEYS.has(key);
    if (!isAllowedKey || process.env[key] !== undefined) return;

    const quoted = rawValue.match(/^(["'])(.*)\1$/);
    process.env[key] = quoted ? quoted[2] : rawValue;
  });
};

loadLocalServerEnv();

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== '');
const isEnabled = (value) => /^(1|true|yes)$/i.test(String(value || ''));

const mysqlUrl = firstDefined(process.env.MYSQL_URL, process.env.MYSQL_PUBLIC_URL);
const hasMysqlUrl = /^mysql:\/\//i.test(mysqlUrl || '');
const parsedMysqlUrl = hasMysqlUrl ? new URL(mysqlUrl) : null;

const poolOptions = {
  waitForConnections: true,
  connectionLimit: Number(firstDefined(process.env.DB_CONNECTION_LIMIT, process.env.MYSQL_CONNECTION_LIMIT, 10)),
  queueLimit: 0,
  connectTimeout: Number(firstDefined(process.env.DB_CONNECT_TIMEOUT, process.env.MYSQL_CONNECT_TIMEOUT, 10000)),
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true
};

if (isEnabled(firstDefined(process.env.DB_SSL, process.env.MYSQL_SSL))) {
  poolOptions.ssl = {
    rejectUnauthorized: !/^(0|false|no)$/i.test(String(
      firstDefined(process.env.DB_SSL_REJECT_UNAUTHORIZED, process.env.MYSQL_SSL_REJECT_UNAUTHORIZED, 'true')
    ))
  };
}

const dbConfig = hasMysqlUrl
  ? {
      host: parsedMysqlUrl.hostname,
      port: Number(parsedMysqlUrl.port || 3306),
      database: decodeURIComponent(parsedMysqlUrl.pathname.replace(/^\//, '')),
      user: decodeURIComponent(parsedMysqlUrl.username),
      password: decodeURIComponent(parsedMysqlUrl.password),
      ...poolOptions
    }
  : {
      host: firstDefined(process.env.MYSQLHOST, process.env.MYSQL_HOST, process.env.DB_HOST, 'localhost'),
      port: Number(firstDefined(process.env.MYSQLPORT, process.env.MYSQL_PORT, process.env.DB_PORT, 3306)),
      database: firstDefined(process.env.MYSQLDATABASE, process.env.MYSQL_DATABASE, process.env.DB_NAME, process.env.DB_DATABASE, 'its'),
      user: firstDefined(process.env.MYSQLUSER, process.env.MYSQL_USER, process.env.DB_USER, 'admin'),
      password: firstDefined(process.env.MYSQLPASSWORD, process.env.MYSQL_PASSWORD, process.env.DB_PASSWORD, ''),
      ...poolOptions
    };

const pool = mysql.createPool(dbConfig);

const databaseLabel = {
  hostname: dbConfig.host,
  port: dbConfig.port,
  pathname: `/${dbConfig.database}`,
  username: dbConfig.user
};

console.log('MySQL pool configured:', {
  environment: process.env.NODE_ENV || 'development',
  host: databaseLabel.hostname,
  port: databaseLabel.port || 3306,
  database: String(databaseLabel.pathname || '').replace(/^\//, ''),
  user: databaseLabel.username || dbConfig.user
});

pool.getConnection()
  .then((connection) => {
    console.log('MySQL connection established');
    connection.release();
  })
  .catch((error) => {
    console.error('MySQL connection failed:', error.message);
  });

module.exports = pool;
