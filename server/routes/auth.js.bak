const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/database');

const JWT_SECRET = 'your-secret-key';

// Регистрация сотрудника
router.post('/register', async (req, res) => {
  try {
    const { login, password, full_name, department, phone, room } = req.body;

    // Проверка существующего пользователя
    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE login = ?',
      [login]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Пользователь с таким логином уже существует' });
    }

    // Хеширование пароля
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создание пользователя
    const [result] = await db.execute(
      'INSERT INTO users (login, password, role, full_name, department, phone, room) VALUES (?, ?, "employee", ?, ?, ?, ?)',
      [login, hashedPassword, full_name, department, phone, room]
    );

    res.status(201).json({ message: 'Пользователь успешно зарегистрирован' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Вход в систему
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;

    // Поиск пользователя
    const [users] = await db.execute(
      'SELECT * FROM users WHERE login = ?',
      [login]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const user = users[0];

    // Проверка пароля
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    // Создание JWT токена
    const token = jwt.sign(
      { 
        userId: user.id, 
        login: user.login, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Возврат данных пользователя (без пароля)
    const userData = {
      id: user.id,
      login: user.login,
      role: user.role,
      full_name: user.full_name,
      department: user.department,
      phone: user.phone,
      room: user.room
    };

    res.json({
      message: 'Вход успешен',
      token,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

module.exports = router;