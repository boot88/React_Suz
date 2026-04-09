// server/config/database.render.js
const { Pool } = require('pg');

console.log('🔧 Инициализация PostgreSQL пула...');

// Конфигурация из переменных окружения Render
const poolConfig = {
  host: process.env.DB_HOST || 'dpg-d2vakqh5pdvs73b7ju7g-a',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'suz_bd',
  user: process.env.DB_USER || 'suz_bd_user',
  password: process.env.DB_PASSWORD || 'tOU6wdBLnkeSOuYSrvCFpnQ3oLL1f8vk',
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false 
  } : false,
  // Таймауты и настройки для надежности
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10
};

const pool = new Pool(poolConfig);

// Проверка подключения
pool.on('connect', (client) => {
  console.log('✅ Новое подключение к PostgreSQL установлено');
});

pool.on('error', (err, client) => {
  console.error('❌ Ошибка PostgreSQL пула:', err);
});

// Тестовое подключение при запуске
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
  } else {
    console.log('✅ Успешное подключение к PostgreSQL');
    release();
  }
});

module.exports = pool;