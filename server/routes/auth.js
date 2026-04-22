const express = require('express');
const crypto = require('crypto');
const tls = require('tls');
const router = express.Router();
const db = require('../config/database');
const mailConfig = require('../config/mail');

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


const waitForResponse = (socket, expectedCodes = []) => new Promise((resolve, reject) => {
  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\r\n').filter(Boolean);
    if (!lines.length) return;

    const lastLine = lines[lines.length - 1];
    if (!/^\d{3}\s/.test(lastLine)) return;

    socket.off('data', onData);
    const code = Number(lastLine.slice(0, 3));
    if (expectedCodes.length && !expectedCodes.includes(code)) {
      reject(new Error(`SMTP error ${code}: ${lastLine}`));
      return;
    }
    resolve({ code, line: lastLine });
  };

  socket.on('data', onData);
});

const smtpCommand = async (socket, command, expectedCodes) => {
  socket.write(`${command}\r\n`);
  return waitForResponse(socket, expectedCodes);
};

const sendEmailViaGmailSmtp = async ({ to, subject, text }) => {
  if (!mailConfig.pass) {
    throw new Error('SMTP_APP_PASSWORD не задан. Укажите пароль приложения Gmail.');
  }

  const socket = tls.connect({
    host: mailConfig.host,
    port: mailConfig.port,
    servername: mailConfig.host
  });

  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });

  try {
    await waitForResponse(socket, [220]);
    await smtpCommand(socket, `EHLO localhost`, [250]);
    await smtpCommand(socket, 'AUTH LOGIN', [334]);
    await smtpCommand(socket, Buffer.from(mailConfig.user).toString('base64'), [334]);
    await smtpCommand(socket, Buffer.from(mailConfig.pass).toString('base64'), [235]);
    await smtpCommand(socket, `MAIL FROM:<${mailConfig.from}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(socket, 'DATA', [354]);

    const message = [
      `From: ${mailConfig.from}`,
      `To: ${to}`,
      `Reply-To: ${mailConfig.replyTo}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      text
    ].join('\r\n');

    socket.write(`${message}\r\n.\r\n`);
    await waitForResponse(socket, [250]);
    await smtpCommand(socket, 'QUIT', [221]);
  } finally {
    socket.end();
  }
};

const sendPasswordNotification = async ({ login, password, fullName, mode }) => {
  const subject = mode === 'forgot'
    ? 'Восстановление доступа к системе'
    : 'Данные доступа к системе';

  const text = [
    `Здравствуйте${fullName ? `, ${fullName}` : ''}!`,
    '',
    mode === 'forgot'
      ? 'Для вас создан новый временный пароль.'
      : 'Вам создан доступ в систему.',
    `Логин: ${login}`,
    `Пароль: ${password}`,
    '',
    'Рекомендуем сменить пароль после входа.'
  ].join('\n');

  try {
    await sendEmailViaGmailSmtp({ to: login, subject, text });
    return true;
  } catch (error) {
    console.warn('Не удалось отправить email через Gmail SMTP:', error.message);
    return false;
  }
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

    const emailSent = await sendPasswordNotification({
      login: normalizedLogin,
      password: generatedPassword,
      fullName: full_name || normalizedLogin,
      mode: 'register'
    });

    res.status(201).json({
      message: emailSent
        ? `Пользователь успешно зарегистрирован. Пароль отправлен на ${normalizedLogin}.`
        : 'Пользователь зарегистрирован, но отправка email не выполнена (проверьте SMTP-настройки Gmail).',
      emailSent,
      sentTo: normalizedLogin
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
    const rawLogin = req.body?.login || req.body?.email;
    const normalizedLogin = normalizeLogin(rawLogin);

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

    const emailSent = await sendPasswordNotification({
      login: normalizedLogin,
      password: temporaryPassword,
      fullName: user.full_name,
      mode: 'forgot'
    });

    res.json({
      message: emailSent
        ? `Новый пароль отправлен на ${normalizedLogin}.`
        : 'Пароль обновлен, но email не отправлен (проверьте SMTP-настройки Gmail).',
      emailSent,
      sentTo: normalizedLogin
    });
  } catch (error) {
    console.error('Forgot password error:', error);
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
