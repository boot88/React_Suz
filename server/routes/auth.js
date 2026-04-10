const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/database');

const JWT_SECRET = 'your-secret-key';
const presenceStore = new Map();

// Регистрация сотрудника
router.post('/register', async (req, res) => {
  try {
    const { login, password, full_name = null, department = null, phone = null, room = null } = req.body;

    if (!login || !password) {
      return res.status(400).json({ message: 'Логин и пароль обязательны' });
    }

    const normalizedLogin = String(login).trim().toLowerCase();

    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE LOWER(login) = ? LIMIT 1',
      [normalizedLogin]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Пользователь с таким логином уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.execute(
      'INSERT INTO users (login, password, role, full_name, department, phone, room) VALUES (?, ?, "employee", ?, ?, ?, ?)',
      [normalizedLogin, hashedPassword, full_name, department, phone, room]
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
    const normalizedLogin = String(login || '').trim().toLowerCase();

    const [users] = await db.execute(
      'SELECT * FROM users WHERE LOWER(login) = ? LIMIT 1',
      [normalizedLogin]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const user = users[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        login: user.login,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

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

// Список сотрудников для чата
router.get('/employees', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT login FROM users WHERE role = "employee" ORDER BY login ASC'
    );

    const now = Date.now();
    const employees = rows.map((row) => {
      const key = String(row.login).toLowerCase();
      const presence = presenceStore.get(key);
      const lastSeen = presence?.lastSeen || null;
      const isOnline = Boolean(presence?.isOnline)
        && lastSeen
        && (now - new Date(lastSeen).getTime()) < 2 * 60 * 1000;

      return {
        email: row.login,
        isOnline,
        lastSeen
      };
    });

    res.json(employees);
  } catch (error) {
    console.error('Employees list error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Обновление presence сотрудника
router.post('/presence', async (req, res) => {
  try {
    const { login, isOnline } = req.body;
    const normalizedLogin = String(login || '').trim().toLowerCase();

    if (!normalizedLogin) {
      return res.status(400).json({ message: 'login обязателен' });
    }

    presenceStore.set(normalizedLogin, {
      isOnline: Boolean(isOnline),
      lastSeen: new Date().toISOString()
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Presence update error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

module.exports = router;
