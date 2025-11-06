const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../config/database');

const JWT_SECRET = 'your-secret-key';

// Демо-аккаунты
const DEMO_ACCOUNTS = {
  admin: {
    id: -1,
    login: 'admin',
    password: 'admin123', // В реальном коде это будет хеш
    role: 'admin',
    full_name: 'Администратор Системы',
    department: 'IT',
    phone: '+7 (999) 123-45-67',
    room: '101'
  },
  user: {
    id: -2,
    login: 'user',
    password: 'user123', // В реальном коде это будет хеш
    role: 'employee',
    full_name: 'Иванов Иван Иванович',
    department: 'Отдел продаж',
    phone: '+7 (999) 765-43-21',
    room: '205'
  }
};

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
      [login, hashedPassword, full_name, department || null, phone || null, room || null]
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

    // Валидация входных данных
    if (!login || !password) {
      return res.status(400).json({ message: 'Логин и пароль обязательны' });
    }

    // Проверка демо-аккаунтов
    if (DEMO_ACCOUNTS[login]) {
      const demoUser = DEMO_ACCOUNTS[login];
      if (password === demoUser.password) {
        // Создаем токен для демо-пользователя
        const tokenPayload = {
          id: demoUser.id,
          login: demoUser.login,
          role: demoUser.role,
          full_name: demoUser.full_name,
          department: demoUser.department,
          phone: demoUser.phone,
          room: demoUser.room
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

        return res.json({
          message: 'Вход успешен (демо-аккаунт)',
          token,
          user: tokenPayload
        });
      } else {
        return res.status(401).json({ message: 'Неверный логин или пароль' });
      }
    }

    // Поиск пользователя в базе данных
    const [rows] = await db.execute('SELECT * FROM users WHERE login = ?', [login]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const dbPass = user.password || '';

    let passwordMatches = false;
    
    if (dbPass.startsWith('$2')) {
      passwordMatches = await bcrypt.compare(password, dbPass);
    } else {
      if (password === dbPass) {
        passwordMatches = true;
        // Рехэшируем пароль если он в открытом виде
        try {
          const newHash = await bcrypt.hash(password, 10);
          await db.execute('UPDATE users SET password = ? WHERE id = ?', [newHash, user.id]);
          console.log('Re-hashed plaintext password for user', user.login);
        } catch (e) {
          console.warn('Failed to re-hash password for user', user.login, e.message);
        }
      }
    }

    if (!passwordMatches) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    // Создаем payload с проверкой на undefined
    const tokenPayload = {
      id: user.id,
      login: user.login,
      role: user.role || 'employee',
      full_name: user.full_name || '',
      department: user.department || '',
      phone: user.phone || '',
      room: user.room || ''
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

    res.json({
      message: 'Вход успешен',
      token,
      user: tokenPayload
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Проверка токена
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Токен отсутствует' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Проверка демо-аккаунтов
    if (decoded.id < 0 && DEMO_ACCOUNTS[decoded.login]) {
      return res.json(DEMO_ACCOUNTS[decoded.login]);
    }

    // Получим актуальные данные пользователя из БД
    const [rows] = await db.execute(
      'SELECT id, login, role, full_name, department, phone, room FROM users WHERE id = ?', 
      [decoded.id]
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Пользователь не найден' });
    }

    res.json(user);
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Неверный токен' });
  }
});

// Эндпоинт для получения информации о демо-аккаунтах (для удобства тестирования)
router.get('/demo-info', (req, res) => {
  res.json({
    demo_accounts: {
      admin: {
        login: 'admin',
        password: 'admin123',
        role: 'admin',
        description: 'Администратор с полными правами'
      },
      user: {
        login: 'user',
        password: 'user123',
        role: 'employee',
        description: 'Обычный сотрудник'
      }
    }
  });
});

module.exports = router;