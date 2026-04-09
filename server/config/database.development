// server/config/database.development.js
const mysql = require('mysql2/promise');

console.log('🔧 Инициализация MySQL пула для разработки...');

const dbConfig = {
  host: 'localhost',
  user: 'admin',
  password: 'MyPass123!',
  database: 'its',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Таймауты
  connectTimeout: 5000,
  acquireTimeout: 5000,
  timeout: 5000
};

const pool = mysql.createPool(dbConfig);

// Проверка подключения
pool.getConnection()
  .then(connection => {
    console.log('✅ Успешное подключение к MySQL');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Ошибка подключения к MySQL:', err.message);
  });

module.exports = pool;
