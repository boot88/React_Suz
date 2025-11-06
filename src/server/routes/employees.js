// server/routes/employees.js
const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Поиск сотрудников
router.get('/search', async (req, res) => {
  console.log('Поиск сотрудников вызван:', new Date().toISOString());
  console.log('Параметры:', req.query);
  
  try {
    const { field, query } = req.query;
    
    if (!field || !query) {
      return res.status(400).json({ error: 'Не указаны поле поиска или запрос' });
    }

    const validFields = ['full_name', 'position', 'department', 'room', 'internal_phone', 'email'];
    if (!validFields.includes(field)) {
      return res.status(400).json({ error: 'Недопустимое поле для поиска' });
    }

    const sql = `SELECT * FROM phone_book WHERE ${field} LIKE ? ORDER BY full_name`;
    const [results] = await pool.execute(sql, [`%${query}%`]);

    console.log('Найдено записей в БД:', results.length);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Ошибка при поиске сотрудников' });
  }
});

// Получение всех отделов
router.get('/departments', async (req, res) => {
  try {
    const sql = `SELECT DISTINCT department FROM phone_book WHERE department IS NOT NULL ORDER BY department`;
    const [results] = await pool.execute(sql);
    
    const departments = results.map(row => row.department);
    res.json(departments);
  } catch (error) {
    console.error('Departments error:', error);
    res.status(500).json({ error: 'Ошибка при получении отделов' });
  }
});

module.exports = router;