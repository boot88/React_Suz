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

const mapUser = (user) => ({
  id: user.id,
  login: user.login,
  role: user.role,
  full_name: user.full_name,
  department: user.department,
  phone: user.phone,
  room: user.room
});

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

// Список сотрудников (для полу-админа)
router.get('/employees', async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, login, role, full_name, department, phone, room FROM users WHERE role = "employee" ORDER BY login'
    );

    res.json({ employees: users.map(mapUser) });
  } catch (error) {
    console.error('Employees list error:', error);
    res.status(500).json({ message: 'Не удалось получить список сотрудников' });
  }
});

// Обновление сотрудника
router.put('/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { login, password, full_name, department, phone, room } = req.body;
    const normalizedLogin = normalizeLogin(login);

    if (!normalizedLogin) {
      return res.status(400).json({ message: 'Логин обязателен' });
    }

    const [duplicateUsers] = await db.execute(
      'SELECT id FROM users WHERE LOWER(login) = ? AND id <> ?',
      [normalizedLogin, id]
    );

    if (duplicateUsers.length > 0) {
      return res.status(400).json({ message: 'Пользователь с таким логином уже существует' });
    }

    if (password) {
      await db.execute(
        'UPDATE users SET login = ?, password = ?, full_name = ?, department = ?, phone = ?, room = ? WHERE id = ? AND role = "employee"',
        [normalizedLogin, hashPassword(password), full_name || normalizedLogin, department || null, phone || null, room || null, id]
      );
    } else {
      await db.execute(
        'UPDATE users SET login = ?, full_name = ?, department = ?, phone = ?, room = ? WHERE id = ? AND role = "employee"',
        [normalizedLogin, full_name || normalizedLogin, department || null, phone || null, room || null, id]
      );
    }

    const [rows] = await db.execute('SELECT id, login, role, full_name, department, phone, room FROM users WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Сотрудник не найден' });
    }

    res.json({ message: 'Сотрудник обновлён', employee: mapUser(rows[0]) });
  } catch (error) {
    console.error('Employees update error:', error);
    res.status(500).json({ message: 'Не удалось обновить сотрудника' });
  }
});

// Удаление сотрудника
router.delete('/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.execute('DELETE FROM users WHERE id = ? AND role = "employee"', [id]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Сотрудник не найден' });
    }

    res.json({ message: 'Сотрудник удалён' });
  } catch (error) {
    console.error('Employees delete error:', error);
    res.status(500).json({ message: 'Не удалось удалить сотрудника' });
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

    res.json({
      message: 'Вход успешен',
      token: null,
      user: mapUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

module.exports = router;
