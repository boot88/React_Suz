/*const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  user: 'admin',
  password: 'MyPass123!',
  database: 'its',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

module.exports = pool;
*/

// server/config/database.js
console.log('🔄 Загрузка конфигурации БД для окружения:', process.env.NODE_ENV || 'development');

if (process.env.NODE_ENV === 'production') {
  // Для продакшена (Render) - используем PostgreSQL
  console.log('✅ Используется PostgreSQL для production');
  module.exports = require('./database.render');
} else {
  // Для разработки - используем MySQL
  console.log('✅ Используется MySQL для development');
  module.exports = require('./database.development');
}
