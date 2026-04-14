const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../config/database');

const normalizeLogin = (value = '') => value.trim().toLowerCase();
const hashPassword = (value) => `sha256$${crypto.createHash('sha256').update(String(value)).digest('hex')}`;

const isPasswordValid = (rawPassword, storedPassword = '') => {
  if (!storedPassword) return false;

  if (storedPassword.startsWith('sha256$')) {
    return storedPassword === hashPassword(rawPassword);
  }

  // Совместимость со старыми записями, где пароль мог храниться без хеша
  return storedPassword === rawPassword;
};

// Регистрация сотрудника
router.post('/register', async (req, res) => {
  try {
    const { login, password, full_name, department, phone, room } = req.body;
    const normalizedLogin = normalizeLogin(login);

    if (!normalizedLogin || !password) {
      return res.status(400).json({ message: 'Логин и пароль обязательны' });
    }

    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE LOWER(login) = ?',
      [normalizedLogin]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Пользователь с таким логином уже существует' });
    }

    await db.execute(
      'INSERT INTO users (login, password, role, full_name, department, phone, room) VALUES (?, ?, "employee", ?, ?, ?, ?)',
      [normalizedLogin, hashPassword(password), full_name || normalizedLogin, department || null, phone || null, room || null]
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
    const normalizedLogin = normalizeLogin(login);

    if (!normalizedLogin || !password) {
      return res.status(400).json({ message: 'Логин и пароль обязательны' });
    }

    const [users] = await db.execute(
      'SELECT * FROM users WHERE LOWER(login) = ?',
      [normalizedLogin]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const user = users[0];

    if (!isPasswordValid(password, user.password)) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

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
      token: null,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

module.exports = router;
