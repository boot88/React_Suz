const mysql = require('mysql2/promise');

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== '');
const isEnabled = (value) => /^(1|true|yes)$/i.test(String(value || ''));

const mysqlUrl = firstDefined(process.env.MYSQL_URL, process.env.MYSQL_PUBLIC_URL);
const databaseUrl = firstDefined(mysqlUrl, process.env.DATABASE_URL);
const hasMysqlUrl = /^mysql:\/\//i.test(databaseUrl || '');
const parsedMysqlUrl = hasMysqlUrl ? new URL(databaseUrl) : null;

if (databaseUrl && !hasMysqlUrl) {
  console.warn('Ignoring DATABASE_URL because it is not a MySQL URL. Configure MYSQL_URL or the DB_* variables.');
}

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
