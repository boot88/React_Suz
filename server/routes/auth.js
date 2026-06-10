const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const router = express.Router();
const db = require('../config/database');

const normalizeLogin = (value = '') => value.trim().toLowerCase();
const hashPassword = (value) => `sha256$${crypto.createHash('sha256').update(String(value)).digest('hex')}`;

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 7;
const loginAttemptStore = new Map();

const getClientIp = (req) => {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown';
};

const getLoginAttemptKey = (req, login) => `${normalizeLogin(login) || 'unknown'}::${getClientIp(req)}`;

const pruneLoginAttempts = () => {
  const now = Date.now();
  for (const [key, attempt] of loginAttemptStore.entries()) {
    if (!attempt?.lockedUntil && now - attempt.firstAttemptAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
      loginAttemptStore.delete(key);
    }
    if (attempt?.lockedUntil && attempt.lockedUntil <= now) {
      loginAttemptStore.delete(key);
    }
  }
};

const getLoginLock = (key) => {
  pruneLoginAttempts();
  const attempt = loginAttemptStore.get(key);
  if (!attempt?.lockedUntil || attempt.lockedUntil <= Date.now()) return null;
  return attempt.lockedUntil;
};

const recordFailedLogin = (key) => {
  const now = Date.now();
  const current = loginAttemptStore.get(key);
  const base = current && now - current.firstAttemptAt <= LOGIN_RATE_LIMIT_WINDOW_MS
    ? current
    : { count: 0, firstAttemptAt: now, lockedUntil: null };
  const nextCount = base.count + 1;

  loginAttemptStore.set(key, {
    count: nextCount,
    firstAttemptAt: base.firstAttemptAt,
    lockedUntil: nextCount >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS ? now + LOGIN_RATE_LIMIT_WINDOW_MS : null
  });
};

const clearLoginAttempts = (key) => {
  loginAttemptStore.delete(key);
};

const getLockMessage = (lockedUntil) => {
  const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
  return `Слишком много неверных попыток входа. Повторите через ${minutes} мин.`;
};


const isPasswordValid = (rawPassword, storedPassword = '') => {
  if (!storedPassword) return false;

  if (storedPassword.startsWith('sha256$')) {
    return storedPassword === hashPassword(rawPassword);
  }

  // Совместимость со старыми записями, где пароль мог храниться без хеша
  return storedPassword === rawPassword;
};


const dataDir = path.join(__dirname, '..', 'data');
const notificationsFilePath = path.join(dataDir, 'managerNotifications.json');
const chatThreadsFilePath = path.join(dataDir, 'chatThreads.json');
const presenceFilePath = path.join(dataDir, 'presence.json');
const profilesFilePath = path.join(dataDir, 'profiles.json');

const ensureNotificationStorage = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(notificationsFilePath);
  } catch {
    await fs.writeFile(notificationsFilePath, JSON.stringify([], null, 2), 'utf-8');
  }
};

const readNotifications = async () => {
  await ensureNotificationStorage();
  try {
    const raw = await fs.readFile(notificationsFilePath, 'utf-8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Notifications read error:', error);
    return [];
  }
};

const writeNotifications = async (items) => {
  await ensureNotificationStorage();
  await fs.writeFile(notificationsFilePath, JSON.stringify(items, null, 2), 'utf-8');
};

const ensureChatStorage = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(chatThreadsFilePath);
  } catch {
    await fs.writeFile(chatThreadsFilePath, JSON.stringify({}, null, 2), 'utf-8');
  }
};

const readThreads = async () => {
  await ensureChatStorage();
  try {
    const raw = await fs.readFile(chatThreadsFilePath, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Threads read error:', error);
    return {};
  }
};

const writeThreads = async (threads) => {
  await ensureChatStorage();
  await fs.writeFile(chatThreadsFilePath, JSON.stringify(threads, null, 2), 'utf-8');
};

const ensurePresenceStorage = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(presenceFilePath);
  } catch {
    await fs.writeFile(presenceFilePath, JSON.stringify([], null, 2), 'utf-8');
  }
};

const readPresence = async () => {
  await ensurePresenceStorage();
  try {
    const raw = await fs.readFile(presenceFilePath, 'utf-8');
    const parsed = JSON.parse(raw || '[]');
    const now = Date.now();

    return (Array.isArray(parsed) ? parsed : []).map((item) => {
      const lastSeenTimestamp = item.lastSeen ? new Date(item.lastSeen).getTime() : 0;
      const stale = Boolean(item.isOnline) && (!lastSeenTimestamp || now - lastSeenTimestamp > 2 * 60 * 1000);
      return {
        login: normalizeLogin(item.login || item.email || ''),
        isOnline: stale ? false : Boolean(item.isOnline),
        lastSeen: item.lastSeen || null,
        role: item.role || 'employee'
      };
    });
  } catch (error) {
    console.error('Presence read error:', error);
    return [];
  }
};

const writePresence = async (items) => {
  await ensurePresenceStorage();
  await fs.writeFile(presenceFilePath, JSON.stringify(items, null, 2), 'utf-8');
};

const ensureProfilesStorage = async () => {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(profilesFilePath);
  } catch {
    await fs.writeFile(profilesFilePath, JSON.stringify({}, null, 2), 'utf-8');
  }
};

const readProfiles = async () => {
  await ensureProfilesStorage();
  try {
    const raw = await fs.readFile(profilesFilePath, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Profiles read error:', error);
    return {};
  }
};

const writeProfiles = async (items) => {
  await ensureProfilesStorage();
  await fs.writeFile(profilesFilePath, JSON.stringify(items, null, 2), 'utf-8');
};

const upsertPresence = async ({ login, isOnline, role }) => {
  const normalizedLogin = normalizeLogin(login);
  if (!normalizedLogin) return;

  const presence = await readPresence();
  const now = new Date().toISOString();
  const existingIndex = presence.findIndex((item) => item.login === normalizedLogin);

  if (existingIndex === -1) {
    presence.push({
      login: normalizedLogin,
      isOnline: Boolean(isOnline),
      lastSeen: now,
      role: role || 'employee'
    });
  } else {
    presence[existingIndex] = {
      ...presence[existingIndex],
      isOnline: Boolean(isOnline),
      lastSeen: now,
      role: role || presence[existingIndex].role || 'employee'
    };
  }

  await writePresence(presence);
};

const getConversationId = (a, b) => [String(a || '').toLowerCase(), String(b || '').toLowerCase()].sort().join('::');

const appendSystemResetMessages = async ({ employee, temporaryPassword, managerLogins }) => {
  const threads = await readThreads();
  const now = new Date().toISOString();

  managerLogins.forEach((managerLogin) => {
    const conversationId = getConversationId(employee.login, managerLogin);
    const current = Array.isArray(threads[conversationId]) ? threads[conversationId] : [];
    const systemMessage = {
      id: crypto.randomUUID(),
      sender: 'system',
      text: [
        '🔐 Запрос на восстановление пароля',
        `Сотрудник: ${employee.full_name || employee.login}`,
        `Логин: ${employee.login}`,
        `Внутренний телефон: ${employee.phone || 'не указан'}`,
        `Новый временный пароль: ${temporaryPassword}`
      ].join('\n'),
      createdAt: now,
      editedAt: null,
      reactions: {},
      pinned: false,
      replyTo: null
    };
    threads[conversationId] = [...current, systemMessage];
  });

  await writeThreads(threads);
};

const notifyManagersAboutPasswordReset = async ({ employee, temporaryPassword }) => {
  const [managerRows] = await db.execute(
    'SELECT id, login FROM users WHERE role = "manager" ORDER BY id'
  );

  const recipients = managerRows.length
    ? managerRows.map((row) => row.login)
    : ['manager_nioh'];

  const baseNotification = {
    createdAt: new Date().toISOString(),
    type: 'password_reset_request',
    employee: {
      id: employee.id,
      login: employee.login,
      full_name: employee.full_name || employee.login,
      phone: employee.phone || ''
    },
    temporaryPassword
  };

  const notifications = await readNotifications();
  const notificationsToAdd = recipients.map((managerLogin) => ({
    id: crypto.randomUUID(),
    managerLogin,
    isRead: false,
    ...baseNotification
  }));

  await writeNotifications([...notifications, ...notificationsToAdd]);
  return recipients;
};

const generateTemporaryPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
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
    const { login, full_name, department, phone, room } = req.body;
    const normalizedLogin = normalizeLogin(login);
    const generatedPassword = generateTemporaryPassword();

    if (!normalizedLogin) {
      return res.status(400).json({ message: 'Email (логин) обязателен' });
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
      [normalizedLogin, hashPassword(generatedPassword), full_name || normalizedLogin, department || null, phone || null, room || null]
    );

    res.status(201).json({
      message: `Пользователь успешно зарегистрирован. Временный пароль создан для логина ${normalizedLogin}.`,
      temporaryPassword: generatedPassword
    });
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


// Восстановление пароля (отправка нового временного пароля)
router.post('/forgot-password', async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(req.body?.login);

    if (!normalizedLogin) {
      return res.status(400).json({ message: 'Укажите email/логин' });
    }

    const [users] = await db.execute(
      'SELECT * FROM users WHERE LOWER(login) = ? AND role = "employee"',
      [normalizedLogin]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const user = users[0];
    const temporaryPassword = generateTemporaryPassword();

    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashPassword(temporaryPassword), user.id]
    );

    const managerRecipients = await notifyManagersAboutPasswordReset({
      employee: user,
      temporaryPassword
    });
    await appendSystemResetMessages({
      employee: user,
      temporaryPassword,
      managerLogins: managerRecipients
    });

    res.json({
      message: 'Запрос на восстановление пароля отправлен менеджерам.',
      sentToManagers: managerRecipients
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Получение уведомлений менеджера по логину
router.get('/manager-notifications', async (req, res) => {
  try {
    const managerLogin = normalizeLogin(req.query?.managerLogin || '');
    if (!managerLogin) {
      return res.status(400).json({ message: 'managerLogin обязателен' });
    }

    const notifications = await readNotifications();
    const managerItems = notifications.filter((item) => normalizeLogin(item.managerLogin) === managerLogin);
    res.json({ notifications: managerItems });
  } catch (error) {
    console.error('Manager notifications error:', error);
    res.status(500).json({ message: 'Не удалось получить уведомления менеджера' });
  }
});

router.get('/presence', async (req, res) => {
  try {
    const presence = await readPresence();
    res.json({
      presence: presence.map((item) => ({
        email: item.login,
        isOnline: Boolean(item.isOnline),
        lastSeen: item.lastSeen,
        role: item.role || 'employee'
      }))
    });
  } catch (error) {
    console.error('Presence list error:', error);
    res.status(500).json({ message: 'Не удалось получить статус онлайн' });
  }
});

router.post('/presence', async (req, res) => {
  try {
    const login = normalizeLogin(req.body?.login);
    if (!login) {
      return res.status(400).json({ message: 'login обязателен' });
    }

    await upsertPresence({
      login,
      isOnline: Boolean(req.body?.isOnline),
      role: req.body?.role || 'employee'
    });

    res.json({ message: 'Статус обновлён' });
  } catch (error) {
    console.error('Presence update error:', error);
    res.status(500).json({ message: 'Не удалось обновить статус онлайн' });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(req.query?.login || '');
    if (!normalizedLogin) {
      return res.status(400).json({ message: 'login обязателен' });
    }

    const [users] = await db.execute(
      'SELECT id, login, role, full_name, department, phone, room FROM users WHERE LOWER(login) = ?',
      [normalizedLogin]
    );

    const user = users[0] || null;
    if (!user && normalizedLogin !== 'manager_nioh') {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const profiles = await readProfiles();
    const extras = profiles[normalizedLogin] || {};
    res.json({
      profile: {
        login: user?.login || normalizedLogin,
        role: user?.role || (normalizedLogin === 'manager_nioh' ? 'manager' : 'employee'),
        full_name: user?.full_name || extras.full_name || normalizedLogin,
        department: user?.department || extras.department || '',
        phone: user?.phone || extras.phone || '',
        room: user?.room || extras.room || '',
        position: extras.position || '',
        bio: extras.bio || '',
        website: extras.website || '',
        statusText: extras.statusText || '',
        avatar: extras.avatar || ''
      }
    });
  } catch (error) {
    console.error('Profile get error:', error);
    res.status(500).json({ message: 'Не удалось получить анкету' });
  }
});

router.put('/profile', async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(req.body?.login || '');
    if (!normalizedLogin) {
      return res.status(400).json({ message: 'login обязателен' });
    }

    const [users] = await db.execute(
      'SELECT id FROM users WHERE LOWER(login) = ?',
      [normalizedLogin]
    );

    if (users.length > 0) {
      await db.execute(
        'UPDATE users SET full_name = ?, department = ?, phone = ?, room = ? WHERE LOWER(login) = ?',
        [
          req.body?.full_name || normalizedLogin,
          req.body?.department || null,
          req.body?.phone || null,
          req.body?.room || null,
          normalizedLogin
        ]
      );
    }

    const profiles = await readProfiles();
    profiles[normalizedLogin] = {
      ...(profiles[normalizedLogin] || {}),
      full_name: req.body?.full_name || normalizedLogin,
      department: req.body?.department || '',
      phone: req.body?.phone || '',
      room: req.body?.room || '',
      position: req.body?.position || '',
      bio: req.body?.bio || '',
      website: req.body?.website || '',
      statusText: req.body?.statusText || '',
      avatar: req.body?.avatar || profiles[normalizedLogin]?.avatar || ''
    };
    await writeProfiles(profiles);

    res.json({ message: 'Анкета обновлена' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Не удалось сохранить анкету' });
  }
});

router.put('/change-password', async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(req.body?.login || '');
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!normalizedLogin || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'login, currentPassword и newPassword обязательны' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Новый пароль должен содержать минимум 8 символов' });
    }

    const [users] = await db.execute('SELECT id, password FROM users WHERE LOWER(login) = ?', [normalizedLogin]);
    if (!users.length) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (!isPasswordValid(currentPassword, users[0].password)) {
      return res.status(400).json({ message: 'Текущий пароль указан неверно' });
    }

    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashPassword(newPassword), users[0].id]);
    res.json({ message: 'Пароль обновлён' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Не удалось сменить пароль' });
  }
});

// Вход в систему
router.post('/login', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { login, password } = req.body;
    const normalizedLogin = normalizeLogin(login);
    const passwordValue = String(password || '');
    const attemptKey = getLoginAttemptKey(req, normalizedLogin);
    const lockedUntil = getLoginLock(attemptKey);

    if (lockedUntil) {
      return res.status(429).json({ message: getLockMessage(lockedUntil) });
    }

    if (!normalizedLogin || !passwordValue) {
      return res.status(400).json({ message: 'Логин и пароль обязательны' });
    }

    if (normalizedLogin.length > 255 || passwordValue.length > 256) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const [users] = await db.execute(
      'SELECT * FROM users WHERE LOWER(login) = ?',
      [normalizedLogin]
    );

    if (users.length === 0) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const user = users[0];

    if (!isPasswordValid(passwordValue, user.password)) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    clearLoginAttempts(attemptKey);

    if (user.password && !String(user.password).startsWith('sha256$')) {
      await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashPassword(passwordValue), user.id]);
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
