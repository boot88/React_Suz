const express = require('express');
const crypto = require('crypto');
const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const router = express.Router();
const db = require('../config/database');
const employeeRoutes = require('./employees');
const { isMysqlDatabase } = require('../utils/chatState');
const {
  getRequestValue
} = require('../utils/profileState');
const { createAccessToken } = require('../utils/accessToken');
const {
  hashPassword,
  verifyPassword: isPasswordValid,
  passwordNeedsUpgrade
} = require('../utils/password');
const {
  requireAuth,
  requireAuthAllowQuery,
  requireRole
} = require('../middleware/auth');

const normalizeLogin = (value = '') => value.trim().toLowerCase();

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 7;
const loginAttemptStore = new Map();
const PASSWORD_RESET_COOLDOWN_MS = 10 * 60 * 1000;
const passwordResetRequestStore = new Map();

const getClientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

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


const dataDir = path.join(__dirname, '..', 'data');
const notificationsFilePath = path.join(dataDir, 'managerNotifications.json');
const presenceFilePath = path.join(dataDir, 'presence.json');
const profileAvatarDir = path.join(__dirname, '..', 'uploads', 'profile');

const DEFAULT_EMPLOYEE_PASSWORD = String(process.env.DEFAULT_EMPLOYEE_PASSWORD || '');
const DEFAULT_ADMIN_PASSWORD = String(process.env.DEFAULT_ADMIN_PASSWORD || '');
const MANAGER_LOGIN = normalizeLogin(process.env.MANAGER_LOGIN || '');
const MANAGER_PASSWORD = String(process.env.MANAGER_PASSWORD || '');
const MANAGER_NAME = String(process.env.MANAGER_NAME || 'Ответственный менеджер').trim();
const DEFAULT_PROFILE_WEBSITE_LANGUAGE = 'en';
const PROFILE_WEBSITE_BY_LANGUAGE = {
  en: 'http://web3.nioch.nsc.ru/nioch/index.php/en/',
  ru: 'http://web3.nioch.nsc.ru/nioch/index.php/ru/'
};
const DEFAULT_PROFILE_WEBSITE = PROFILE_WEBSITE_BY_LANGUAGE[DEFAULT_PROFILE_WEBSITE_LANGUAGE];
const getProfileWebsiteByLanguage = (language = DEFAULT_PROFILE_WEBSITE_LANGUAGE) => PROFILE_WEBSITE_BY_LANGUAGE[language] || DEFAULT_PROFILE_WEBSITE;
const getStoredProfileWebsite = (profile = {}) => {
  const language = profile.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE;
  const website = profile.website || '';
  const isKnownDefault = Object.values(PROFILE_WEBSITE_BY_LANGUAGE).includes(website);
  return isKnownDefault ? getProfileWebsiteByLanguage(language) : (website || getProfileWebsiteByLanguage(language));
};
const DEFAULT_PROFILE_STATUS = 'Работа';
const MAX_AVATAR_BYTES = 1024 * 1024;
const PROFILE_PREFERENCE_ARRAY_KEYS = new Set(['archived', 'hidden', 'pinned', 'muted', 'favorites']);
const PROFILE_PREFERENCE_BOOLEAN_KEYS = new Set([
  'showChatTemplates',
  'showExtraMessageActions',
  'showDialogMediaPanel',
  'showDialogFilters',
  'showDialogDateJump',
  'showConversationMenu',
  'showFeedCategorySelect',
  'showFeedFilters',
  'enterToSend'
]);
const PROFILE_PREFERENCE_ENUMS = {
  uiTheme: new Set(['light', 'dark']),
  uiDensity: new Set(['compact', 'regular', 'comfortable']),
  uiTextSize: new Set(['small', 'medium', 'large'])
};
const ADMIN_FULL_NAMES = [
  'Повисок Е.В.',
  'Андреев Р.В.',
  'Сальников Георгий Ефимович',
  'Польников Д.В.'
];
let lastProvisionAt = 0;
let missingProvisionPasswordsWarned = false;
let usersSchemaReady = false;
let usersSchemaPromise = null;
let managerAccountReady = false;
let managerAccountPromise = null;

const ensureUsersSchema = async () => {
  if (usersSchemaReady) return;
  if (usersSchemaPromise) return usersSchemaPromise;

  usersSchemaPromise = (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      login VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(40) NOT NULL DEFAULT 'employee',
      full_name VARCHAR(255) NOT NULL,
      position VARCHAR(255) NULL,
      department VARCHAR(255) NULL,
      phone VARCHAR(100) NULL,
      room VARCHAR(100) NULL,
      provisioned_from_directory TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_users_login (login),
      INDEX idx_users_role_name (role, full_name)
    )`);

    const [columns] = await db.execute('SHOW COLUMNS FROM users');
    const existing = new Set((columns || []).map((column) => column.Field));
    if (!existing.has('provisioned_from_directory')) {
      await db.execute('ALTER TABLE users ADD COLUMN provisioned_from_directory TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!existing.has('position')) {
      await db.execute('ALTER TABLE users ADD COLUMN position VARCHAR(255) NULL');
    }
    usersSchemaReady = true;
  })().finally(() => {
    usersSchemaPromise = null;
  });

  return usersSchemaPromise;
};

const ensureManagerAccount = async () => {
  if (!MANAGER_LOGIN || !MANAGER_PASSWORD) return false;
  if (managerAccountReady) return false;
  if (managerAccountPromise) return managerAccountPromise;

  managerAccountPromise = (async () => {
    const [existing] = await db.execute('SELECT id FROM users WHERE LOWER(login) = ? LIMIT 1', [MANAGER_LOGIN]);
    if (existing.length) {
      managerAccountReady = true;
      return false;
    }
    const [result] = await db.execute(
      `INSERT IGNORE INTO users
       (login, password, role, full_name, position, department, phone, room, provisioned_from_directory)
       VALUES (?, ?, "manager", ?, NULL, NULL, NULL, NULL, 0)`,
      [MANAGER_LOGIN, await hashPassword(MANAGER_PASSWORD), MANAGER_NAME || MANAGER_LOGIN]
    );
    managerAccountReady = true;
    return Boolean(result.affectedRows);
  })().finally(() => {
    managerAccountPromise = null;
  });
  return managerAccountPromise;
};

const normalizePersonName = (value = '') => String(value)
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^а-яa-z]/g, '');

const getNameParts = (fullName = '') => String(fullName)
  .replace(/\./g, ' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const getShortPersonName = (fullName = '') => {
  const [lastName = '', firstName = '', middleName = ''] = getNameParts(fullName);
  const initials = [firstName, middleName].filter(Boolean).map((part) => `${part[0].toUpperCase()}.`).join('');
  return `${lastName}${initials ? ` ${initials}` : ''}`;
};

const joinUniqueValues = (values = []) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].join(', ');

const createBaseLoginFromName = (fullName = '') => getShortPersonName(fullName)
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\.$/, '');

const isConfiguredAdminName = (fullName = '') => {
  const normalized = normalizePersonName(fullName);
  return ADMIN_FULL_NAMES.some((adminName) => normalizePersonName(adminName) === normalized);
};

const createUniqueLogin = (baseLogin, usedLogins) => {
  let login = baseLogin || `employee${usedLogins.size + 1}`;
  let counter = 2;
  while (usedLogins.has(login)) {
    login = `${baseLogin}-${counter}`;
    counter += 1;
  }
  usedLogins.add(login);
  return login;
};

const AVATAR_MIME_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

const isValidAvatarSignature = (buffer, mime) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
};

const sanitizeProfilePreferences = (preferences = {}) => {
  const result = {};
  Object.entries(preferences).forEach(([key, value]) => {
    if (PROFILE_PREFERENCE_ARRAY_KEYS.has(key)) {
      result[key] = [...new Set((Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean))]
        .slice(0, 500);
      return;
    }
    if (PROFILE_PREFERENCE_BOOLEAN_KEYS.has(key)) {
      result[key] = Boolean(value);
      return;
    }
    if (PROFILE_PREFERENCE_ENUMS[key]?.has(value)) {
      result[key] = value;
    }
  });
  return result;
};

const provisionUsersFromPhoneBook = async () => {
  await ensureUsersSchema();
  if (!DEFAULT_EMPLOYEE_PASSWORD || !DEFAULT_ADMIN_PASSWORD) {
    const error = new Error('Для синхронизации пользователей задайте DEFAULT_EMPLOYEE_PASSWORD и DEFAULT_ADMIN_PASSWORD в переменных окружения');
    error.status = 503;
    throw error;
  }

  const [phoneRows] = await db.execute(
    `SELECT full_name, position, department, room, internal_phone, email
     FROM phone_book
     WHERE is_active = 1 AND full_name IS NOT NULL AND TRIM(full_name) <> ''
     ORDER BY full_name`
  );

  const usedLogins = new Set();
  const desiredUsers = [];

  const employeesByName = new Map();
  phoneRows.forEach((employee) => {
    const key = normalizePersonName(employee.full_name);
    if (!key) return;
    const current = employeesByName.get(key) || { ...employee, departments: [], positions: [], rooms: [], phones: [] };
    current.departments.push(employee.department);
    current.positions.push(employee.position);
    current.rooms.push(employee.room);
    current.phones.push(employee.internal_phone);
    employeesByName.set(key, current);
  });

  [...employeesByName.values()].forEach((employee) => {
    const baseLogin = createBaseLoginFromName(employee.full_name || employee.email || '');
    const login = createUniqueLogin(baseLogin, usedLogins);
    const isAdmin = isConfiguredAdminName(employee.full_name);
    const departments = joinUniqueValues(employee.departments);
    const positions = joinUniqueValues(employee.positions);

    desiredUsers.push({
      login,
      role: isAdmin ? 'admin' : 'employee',
      initialPassword: isAdmin ? DEFAULT_ADMIN_PASSWORD : DEFAULT_EMPLOYEE_PASSWORD,
      full_name: employee.full_name,
      department: departments || null,
      position: positions || null,
      phone: joinUniqueValues(employee.phones) || null,
      room: joinUniqueValues(employee.rooms) || null
    });
  });

  for (const adminName of ADMIN_FULL_NAMES) {
    if (desiredUsers.some((item) => normalizePersonName(item.full_name) === normalizePersonName(adminName))) continue;
    const login = createUniqueLogin(createBaseLoginFromName(adminName), usedLogins);
    desiredUsers.push({
      login,
      role: 'admin',
      initialPassword: DEFAULT_ADMIN_PASSWORD,
      full_name: adminName,
      department: null,
      position: null,
      phone: null,
      room: null
    });
  }

  const desiredLogins = desiredUsers.map((item) => item.login);

  await db.execute(
    'DELETE FROM users WHERE provisioned_from_directory = 1 AND login NOT IN (?)',
    [desiredLogins.length ? desiredLogins : ['__none__']]
  );

  for (const user of desiredUsers) {
    const passwordHash = await hashPassword(user.initialPassword);
    await db.execute(
      `INSERT INTO users (login, password, role, full_name, position, department, phone, room, provisioned_from_directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role),
         full_name = VALUES(full_name),
         position = VALUES(position),
         department = VALUES(department),
         phone = VALUES(phone),
         room = VALUES(room),
         provisioned_from_directory = 1`,
      [user.login, passwordHash, user.role, user.full_name, user.position, user.department, user.phone, user.room]
    );
  }

  lastProvisionAt = Date.now();

  return {
    total: desiredUsers.length,
    employees: desiredUsers.filter((item) => item.role === 'employee').length,
    admins: desiredUsers.filter((item) => item.role === 'admin').length,
    adminLogins: desiredUsers.filter((item) => item.role === 'admin').map((item) => ({ login: item.login, full_name: item.full_name }))
  };
};

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

const parseProfileJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

let profilesSqlReady = false;
let profilesSqlCheckPromise = null;
let profilesSqlRetryAt = 0;

const ensureProfilesSqlSchema = async () => {
  if (profilesSqlReady) return true;
  if (profilesSqlCheckPromise) return profilesSqlCheckPromise;
  if (Date.now() < profilesSqlRetryAt) return false;

  profilesSqlCheckPromise = (async () => {
    if (!isMysqlDatabase(db)) throw new Error('MySQL client is unavailable');

    await db.execute(`CREATE TABLE IF NOT EXISTS employee_profiles (
      login VARCHAR(255) PRIMARY KEY,
      profile_json LONGTEXT NOT NULL,
      avatar_stored_name VARCHAR(255) NULL,
      avatar_mime VARCHAR(100) NULL,
      avatar_size INT UNSIGNED NULL,
      avatar_updated_at DATETIME NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_employee_profiles_updated (updated_at)
    )`);
    const [columns] = await db.execute('SHOW COLUMNS FROM employee_profiles');
    const existing = new Set((columns || []).map((column) => column.Field));
    const missing = [
      ['avatar_stored_name', 'VARCHAR(255) NULL'],
      ['avatar_mime', 'VARCHAR(100) NULL'],
      ['avatar_size', 'INT UNSIGNED NULL'],
      ['avatar_updated_at', 'DATETIME NULL']
    ].filter(([name]) => !existing.has(name));
    for (const [name, definition] of missing) {
      await db.execute(`ALTER TABLE employee_profiles ADD COLUMN ${name} ${definition}`);
    }

    profilesSqlReady = true;
    profilesSqlRetryAt = 0;
    return true;
  })()
    .catch((error) => {
      profilesSqlReady = false;
      profilesSqlRetryAt = Date.now() + 5000;
      console.warn('Profile SQL storage unavailable:', error.message);
      return false;
    })
    .finally(() => {
      profilesSqlCheckPromise = null;
    });

  return profilesSqlCheckPromise;
};

const readSqlProfiles = async () => {
  if (!await ensureProfilesSqlSchema()) return null;
  const [rows] = await db.execute('SELECT login, profile_json, avatar_stored_name, avatar_mime, avatar_size, avatar_updated_at FROM employee_profiles');

  return Object.fromEntries((rows || [])
    .map((row) => [normalizeLogin(row.login), {
      ...(parseProfileJson(row.profile_json) || {}),
      avatarStoredName: row.avatar_stored_name || '',
      avatarMime: row.avatar_mime || '',
      avatarSize: Number(row.avatar_size || 0),
      avatarUpdatedAt: row.avatar_updated_at ? new Date(row.avatar_updated_at).toISOString() : null
    }])
    .filter(([login, profile]) => login && profile));
};

const readSqlProfile = async (login) => {
  if (!await ensureProfilesSqlSchema()) return null;
  const [rows] = await db.execute(
    'SELECT profile_json, avatar_stored_name, avatar_mime, avatar_size, avatar_updated_at FROM employee_profiles WHERE login = ? LIMIT 1',
    [normalizeLogin(login)]
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    ...(parseProfileJson(row.profile_json) || {}),
    avatarStoredName: row.avatar_stored_name || '',
    avatarMime: row.avatar_mime || '',
    avatarSize: Number(row.avatar_size || 0),
    avatarUpdatedAt: row.avatar_updated_at ? new Date(row.avatar_updated_at).toISOString() : null
  };
};

const readProfileByLogin = async (login) => {
  const sqlProfile = await readSqlProfile(login);
  return sqlProfile || {};
};

const writeSqlProfile = async (login, profile = {}) => {
  if (!await ensureProfilesSqlSchema()) {
    const error = new Error('Постоянное хранилище профилей временно недоступно');
    error.status = 503;
    throw error;
  }
  const normalizedLogin = normalizeLogin(login);
  const updatedAt = new Date(profile.updatedAt || Date.now());
  const { avatarStoredName, avatarMime, avatarSize, avatarUpdatedAt, avatar, ...profileJson } = profile;
  const nextProfile = {
    ...profileJson,
    avatarStoredName: avatarStoredName || '',
    avatarMime: avatarMime || '',
    avatarSize: Number(avatarSize || 0),
    avatarUpdatedAt: avatarUpdatedAt || null,
    updatedAt: updatedAt.toISOString()
  };
  const params = [normalizedLogin, JSON.stringify({ ...profileJson, updatedAt: nextProfile.updatedAt }), updatedAt];

  await db.execute(
    `INSERT INTO employee_profiles (login, profile_json, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       profile_json = VALUES(profile_json),
       updated_at = VALUES(updated_at)`,
    params
  );

  return nextProfile;
};

const readProfiles = async () => {
  const sqlProfiles = await readSqlProfiles();
  if (sqlProfiles === null) {
    const error = new Error('Постоянное хранилище профилей временно недоступно');
    error.status = 503;
    throw error;
  }
  return sqlProfiles;
};

let profilesWriteQueue = Promise.resolve();

const persistProfiles = async (items) => {
  const nextProfiles = Object.fromEntries(Object.entries(items || {}).map(([login, profile]) => {
    const updatedAt = profile?.updatedAt || new Date().toISOString();
    return [normalizeLogin(login), { ...(profile || {}), updatedAt }];
  }));
  const savedProfiles = await Promise.all(Object.entries(nextProfiles).map(async ([login, profile]) => [
    login,
    await writeSqlProfile(login, profile)
  ]));
  return Object.fromEntries(savedProfiles);
};

const enqueueProfileWrite = (operation) => {
  const run = profilesWriteQueue
    .catch(() => {})
    .then(operation);
  profilesWriteQueue = run;
  return run;
};

const writeProfiles = async (items) => enqueueProfileWrite(() => persistProfiles(items));

const mutateProfile = async (login, mutator) => enqueueProfileWrite(async () => {
  const profiles = await readProfiles();
  const normalizedLogin = normalizeLogin(login);
  const nextProfile = await mutator({ ...(profiles[normalizedLogin] || {}) });
  const savedProfile = await writeSqlProfile(normalizedLogin, nextProfile);
  return savedProfile;
});

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

const appendSystemResetMessages = async ({ employee, managerLogins }) => {
  const now = new Date().toISOString();

  await Promise.all(managerLogins.map(async (managerLogin) => {
    const conversationId = getConversationId(employee.login, managerLogin);
    const systemMessage = {
      id: crypto.randomUUID(),
      sender: 'system',
      text: [
        '🔐 Запрос на восстановление пароля',
        `Сотрудник: ${employee.full_name || employee.login}`,
        `Логин: ${employee.login}`,
        `Внутренний телефон: ${employee.phone || 'не указан'}`,
        'Пароль не изменён автоматически. Проверьте сотрудника и задайте новый пароль в разделе учётных записей.'
      ].join('\n'),
      createdAt: now,
      editedAt: null,
      reactions: {},
      pinned: false,
      replyTo: null
    };
    await db.execute(
      `INSERT INTO chat_messages
       (id, conversation_id, sender_login, message_json, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         message_json = VALUES(message_json),
         updated_at = VALUES(updated_at)`,
      [
        systemMessage.id,
        conversationId,
        systemMessage.sender,
        JSON.stringify(systemMessage),
        new Date(now),
        new Date(now)
      ]
    );
  }));
};

const notifyManagersAboutPasswordReset = async ({ employee }) => {
  const [managerRows] = await db.execute(
    'SELECT id, login FROM users WHERE role IN ("manager", "admin") ORDER BY role = "manager" DESC, id'
  );

  const recipients = managerRows.map((row) => row.login);

  const baseNotification = {
    createdAt: new Date().toISOString(),
    type: 'password_reset_request',
    employee: {
      id: employee.id,
      login: employee.login,
      full_name: employee.full_name || employee.login,
      phone: employee.phone || ''
    }
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

const mapUser = (user) => ({
  id: user.id,
  login: user.login,
  role: user.role,
  full_name: user.full_name,
  position: user.position || '',
  department: user.department,
  phone: user.phone,
  room: user.room,
  display_name: getShortPersonName(user.full_name || user.login)
});


router.post('/provision-from-phone-book', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const stats = await provisionUsersFromPhoneBook();
    res.json({ message: 'Пользователи синхронизированы со справочником сотрудников', ...stats });
  } catch (error) {
    console.error('Provision users error:', error);
    res.status(500).json({ message: 'Не удалось синхронизировать пользователей со справочником' });
  }
});

router.get('/login-suggestions', async (req, res) => {
  try {
    await ensureUsersSchema();
    const [userCounts] = await db.execute('SELECT COUNT(*) AS total FROM users');
    if (Number(userCounts?.[0]?.total || 0) > 0) {
      await ensureManagerAccount();
    }
    const query = normalizeLogin(req.query?.query || '');
    const role = req.query?.role === 'admin' ? 'admin' : 'employee';
    const like = `${query}%`;
    const [users] = await db.execute(
      `SELECT id, login, role, full_name
       FROM users
       WHERE ${role === 'admin' ? 'role = "admin"' : 'role IN ("employee", "manager")'}
         AND (LOWER(full_name) LIKE ? OR LOWER(login) LIKE ?)
       ORDER BY full_name
       LIMIT 1000`,
      [like, like]
    );

    res.json({
      suggestions: users.map((user) => ({
        id: user.id,
        login: user.login,
        role: user.role,
        full_name: user.full_name,
        display_name: getShortPersonName(user.full_name || user.login)
      }))
    });
  } catch (error) {
    console.error('Login suggestions error:', error);
    res.status(500).json({ message: 'Не удалось получить список сотрудников' });
  }
});


const ensureUsersProvisionedFromPhoneBook = async () => {
  await ensureUsersSchema();
  const [rows] = await db.execute('SELECT COUNT(*) AS total FROM users');
  if (Number(rows?.[0]?.total || 0) > 0) {
    await ensureManagerAccount();
    return null;
  }
  if (!DEFAULT_EMPLOYEE_PASSWORD || !DEFAULT_ADMIN_PASSWORD) {
    if (!missingProvisionPasswordsWarned) {
      missingProvisionPasswordsWarned = true;
      console.warn('Automatic user provisioning is disabled until DEFAULT_EMPLOYEE_PASSWORD and DEFAULT_ADMIN_PASSWORD are configured.');
    }
    const error = new Error('Для первого запуска задайте DEFAULT_EMPLOYEE_PASSWORD и DEFAULT_ADMIN_PASSWORD в переменных окружения Render.');
    error.status = 503;
    throw error;
  }
  await employeeRoutes.ensurePhoneBookData();
  const result = await provisionUsersFromPhoneBook();
  await ensureManagerAccount();
  return result;
};

// Регистрация сотрудника
router.post('/register', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { login, full_name, department, phone, room } = req.body;
    const normalizedLogin = normalizeLogin(login);
    const password = String(req.body?.password || '');
    const role = req.body?.role === 'manager' ? 'manager' : 'employee';

    if (!normalizedLogin) {
      return res.status(400).json({ message: 'Email (логин) обязателен' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Пароль должен содержать минимум 8 символов' });
    }

    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE LOWER(login) = ?',
      [normalizedLogin]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Пользователь с таким логином уже существует' });
    }

    await db.execute(
      'INSERT INTO users (login, password, role, full_name, department, phone, room) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [normalizedLogin, await hashPassword(password), role, full_name || normalizedLogin, department || null, phone || null, room || null]
    );

    res.status(201).json({
      message: `Пользователь успешно зарегистрирован для логина ${normalizedLogin}.`
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Список сотрудников (для полу-админа)
router.get('/employees', requireAuth, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, login, role, full_name, position, department, phone, room FROM users WHERE role IN ("employee", "manager", "admin") ORDER BY login'
    );
    const profiles = await readProfiles();
    res.set('Cache-Control', 'no-store');
    res.json({
      employees: users.map((user) => {
        const mapped = mapUser(user);
        const extras = profiles[normalizeLogin(user.login)] || {};
        const avatarRevision = encodeURIComponent(extras.updatedAt || '');
        const avatar = extras.avatarStoredName
          ? `/api/auth/profile/${encodeURIComponent(user.login)}/avatar?rev=${avatarRevision}`
          : '';
        return {
          ...mapped,
          bio: extras.bio || '',
          websiteLanguage: extras.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE,
          website: getStoredProfileWebsite(extras),
          statusText: extras.statusText || DEFAULT_PROFILE_STATUS,
          avatar,
          profile: {
            ...extras,
            full_name: mapped.full_name,
            position: mapped.position,
            department: mapped.department,
            phone: mapped.phone,
            room: mapped.room,
            avatar
          }
        };
      })
    });
  } catch (error) {
    console.error('Employees list error:', error);
    res.status(500).json({ message: 'Не удалось получить список сотрудников' });
  }
});

// Обновление сотрудника
router.put('/employees/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { login, password, full_name, department, phone, room } = req.body;
    const normalizedLogin = normalizeLogin(login);
    const role = req.body?.role === 'manager' ? 'manager' : 'employee';

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
        'UPDATE users SET login = ?, password = ?, role = ?, full_name = ?, department = ?, phone = ?, room = ? WHERE id = ? AND role IN ("employee", "manager")',
        [normalizedLogin, await hashPassword(password), role, full_name || normalizedLogin, department || null, phone || null, room || null, id]
      );
    } else {
      await db.execute(
        'UPDATE users SET login = ?, role = ?, full_name = ?, department = ?, phone = ?, room = ? WHERE id = ? AND role IN ("employee", "manager")',
        [normalizedLogin, role, full_name || normalizedLogin, department || null, phone || null, room || null, id]
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
router.delete('/employees/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.execute('DELETE FROM users WHERE id = ? AND role IN ("employee", "manager")', [id]);

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
    const now = Date.now();
    for (const [key, requestedAt] of passwordResetRequestStore.entries()) {
      if (now - Number(requestedAt || 0) >= PASSWORD_RESET_COOLDOWN_MS) {
        passwordResetRequestStore.delete(key);
      }
    }
    const requestKey = getLoginAttemptKey(req, normalizedLogin);
    const lastRequestAt = Number(passwordResetRequestStore.get(requestKey) || 0);
    if (now - lastRequestAt < PASSWORD_RESET_COOLDOWN_MS) {
      return res.json({
        message: 'Если учётная запись найдена, запрос передан ответственному сотруднику.'
      });
    }
    passwordResetRequestStore.set(requestKey, now);

    const [users] = await db.execute(
      'SELECT * FROM users WHERE LOWER(login) = ? AND role = "employee"',
      [normalizedLogin]
    );

    if (users.length > 0) {
      const user = users[0];
      const managerRecipients = await notifyManagersAboutPasswordReset({ employee: user });
      await appendSystemResetMessages({
        employee: user,
        managerLogins: managerRecipients
      });
    }

    res.json({
      message: 'Если учётная запись найдена, запрос передан ответственному сотруднику.'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Получение уведомлений менеджера по логину
router.get('/manager-notifications', requireAuth, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const managerLogin = req.auth.login;

    const notifications = await readNotifications();
    const managerItems = notifications.filter((item) => normalizeLogin(item.managerLogin) === managerLogin);
    res.json({ notifications: managerItems });
  } catch (error) {
    console.error('Manager notifications error:', error);
    res.status(500).json({ message: 'Не удалось получить уведомления менеджера' });
  }
});

router.get('/presence', requireAuth, async (req, res) => {
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

router.post('/presence', requireAuth, async (req, res) => {
  try {
    await upsertPresence({
      login: req.auth.login,
      isOnline: Boolean(req.body?.isOnline),
      role: req.auth.role
    });

    res.json({ message: 'Статус обновлён' });
  } catch (error) {
    console.error('Presence update error:', error);
    res.status(500).json({ message: 'Не удалось обновить статус онлайн' });
  }
});

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(req.query?.login || '');
    if (!normalizedLogin) {
      return res.status(400).json({ message: 'login обязателен' });
    }

    const [users] = await db.execute(
      'SELECT id, login, role, full_name, position, department, phone, room FROM users WHERE LOWER(login) = ?',
      [normalizedLogin]
    );

    const user = users[0] || null;
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const profiles = await readProfiles();
    const extras = profiles[normalizedLogin] || {};
    res.set('Cache-Control', 'no-store');
    res.json({
      profile: {
        login: user.login,
        role: user.role,
        full_name: user.full_name || normalizedLogin,
        department: user.department || '',
        phone: user.phone || '',
        room: user.room || '',
        position: user.position || '',
        bio: extras.bio || '',
        websiteLanguage: extras.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE,
        website: getStoredProfileWebsite(extras),
        statusText: extras.statusText || DEFAULT_PROFILE_STATUS,
        avatar: extras.avatarStoredName ? `/api/auth/profile/${encodeURIComponent(user.login)}/avatar?rev=${encodeURIComponent(extras.avatarUpdatedAt || extras.updatedAt || '')}` : '',
        preferences: extras.preferences && typeof extras.preferences === 'object' ? extras.preferences : {},
        updatedAt: extras.updatedAt || null
      }
    });
  } catch (error) {
    console.error('Profile get error:', error);
    res.status(500).json({ message: 'Не удалось получить анкету' });
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  try {
    const normalizedLogin = req.auth.login;

    const savedProfile = await mutateProfile(normalizedLogin, (currentProfile) => ({
      ...currentProfile,
      bio: getRequestValue(req.body, 'bio', currentProfile.bio || ''),
      websiteLanguage: getRequestValue(req.body, 'websiteLanguage', currentProfile.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE),
      website: getRequestValue(
        req.body,
        'website',
        currentProfile.website || PROFILE_WEBSITE_BY_LANGUAGE[req.body?.websiteLanguage] || DEFAULT_PROFILE_WEBSITE
      ),
      statusText: getRequestValue(req.body, 'statusText', currentProfile.statusText || DEFAULT_PROFILE_STATUS),
      preferences: sanitizeProfilePreferences(currentProfile.preferences),
      updatedAt: new Date().toISOString()
    }));

    res.json({ message: 'Анкета обновлена', profile: savedProfile });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось сохранить анкету' });
  }
});

router.put('/profile/preferences', requireAuth, async (req, res) => {
  try {
    const normalizedLogin = req.auth.login;
    const preferences = req.body?.preferences;
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      return res.status(400).json({ message: 'preferences должен быть объектом' });
    }

    const safePreferences = sanitizeProfilePreferences(preferences);
    const savedProfile = await mutateProfile(normalizedLogin, (currentProfile) => ({
      ...currentProfile,
      preferences: safePreferences,
      updatedAt: new Date().toISOString()
    }));
    res.json({
      message: 'Настройки синхронизированы',
      preferences: savedProfile?.preferences || safePreferences
    });
  } catch (error) {
    console.error('Profile preferences update error:', error);
    res.status(500).json({ message: 'Не удалось синхронизировать настройки' });
  }
});

router.get('/profile/:login/avatar', requireAuthAllowQuery, async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(decodeURIComponent(req.params.login || ''));
    if (!normalizedLogin) return res.status(400).json({ message: 'login обязателен' });
    const profile = await readProfileByLogin(normalizedLogin);
    const storedName = path.basename(String(profile.avatarStoredName || ''));
    const avatarPath = path.join(profileAvatarDir, storedName);
    if (!storedName || !avatarPath.startsWith(`${profileAvatarDir}${path.sep}`)) return res.status(404).json({ message: 'Аватар не найден' });
    const stats = await fs.stat(avatarPath).catch(() => null);
    if (!stats?.isFile()) return res.status(404).json({ message: 'Аватар не найден' });
    res.setHeader('Content-Type', profile.avatarMime || 'image/jpeg');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return fsSync.createReadStream(avatarPath).pipe(res);
  } catch (error) {
    console.error('Profile avatar get error:', error);
    return res.status(500).json({ message: 'Не удалось загрузить аватар' });
  }
});

router.post('/profile/avatar', requireAuth, async (req, res) => {
  let temporaryPath = '';
  try {
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = AVATAR_MIME_TYPES.get(mime);
    if (!extension) return res.status(400).json({ message: 'Разрешены только PNG, JPG и WEBP' });
    await ensureProfilesSqlSchema();
    await fs.mkdir(profileAvatarDir, { recursive: true });
    temporaryPath = path.join(profileAvatarDir, `.upload-${process.pid}-${crypto.randomUUID()}.tmp`);
    const output = fsSync.createWriteStream(temporaryPath, { flags: 'wx' });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_AVATAR_BYTES) {
        output.destroy();
        const error = new Error('Размер аватара не должен превышать 1 МБ');
        error.status = 413;
        throw error;
      }
      if (chunks.reduce((total, item) => total + item.length, 0) < 16) chunks.push(chunk);
      if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
    }
    await new Promise((resolve, reject) => { output.once('error', reject); output.end(resolve); });
    const signature = Buffer.concat(chunks).subarray(0, 16);
    if (!size || !isValidAvatarSignature(signature, mime)) {
      const error = new Error('Файл не является корректным изображением');
      error.status = 400;
      throw error;
    }
    const normalizedLogin = req.auth.login;
    const currentProfile = await readProfileByLogin(normalizedLogin);
    const oldName = path.basename(String(currentProfile.avatarStoredName || ''));
    const storedName = `${normalizedLogin.replace(/[^a-z0-9_-]/gi, '_')}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
    await fs.rename(temporaryPath, path.join(profileAvatarDir, storedName));
    temporaryPath = '';
    const nextProfile = await writeSqlProfile(normalizedLogin, { ...currentProfile, updatedAt: new Date().toISOString() });
    await db.execute(
      `UPDATE employee_profiles SET avatar_stored_name = ?, avatar_mime = ?, avatar_size = ?, avatar_updated_at = NOW(), updated_at = NOW() WHERE login = ?`,
      [storedName, mime, size, normalizedLogin]
    );
    if (oldName && oldName !== storedName) await fs.unlink(path.join(profileAvatarDir, oldName)).catch(() => {});
    res.json({ message: 'Аватар обновлён', avatar: `/api/auth/profile/${encodeURIComponent(normalizedLogin)}/avatar?rev=${Date.now()}`, profile: { ...nextProfile, avatarStoredName: storedName } });
  } catch (error) {
    if (temporaryPath) await fs.unlink(temporaryPath).catch(() => {});
    console.error('Profile avatar upload error:', error);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось сохранить аватар' });
  }
});

router.delete('/profile/avatar', requireAuth, async (req, res) => {
  try {
    const profile = await readProfileByLogin(req.auth.login);
    const oldName = path.basename(String(profile.avatarStoredName || ''));
    await db.execute('UPDATE employee_profiles SET avatar_stored_name = NULL, avatar_mime = NULL, avatar_size = NULL, avatar_updated_at = NULL, updated_at = NOW() WHERE login = ?', [req.auth.login]);
    if (oldName) await fs.unlink(path.join(profileAvatarDir, oldName)).catch(() => {});
    res.json({ message: 'Аватар удалён' });
  } catch (error) {
    console.error('Profile avatar delete error:', error);
    res.status(500).json({ message: 'Не удалось удалить аватар' });
  }
});

router.put('/change-password', requireAuth, async (req, res) => {
  try {
    const normalizedLogin = req.auth.login;
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'currentPassword и newPassword обязательны' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Новый пароль должен содержать минимум 8 символов' });
    }

    const [users] = await db.execute('SELECT id, password FROM users WHERE LOWER(login) = ?', [normalizedLogin]);
    if (!users.length) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (!await isPasswordValid(currentPassword, users[0].password)) {
      return res.status(400).json({ message: 'Текущий пароль указан неверно' });
    }

    await db.execute('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(newPassword), users[0].id]);
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

    try {
      await ensureUsersProvisionedFromPhoneBook();
    } catch (error) {
      console.error('Initial user provisioning error:', error);
      return res.status(error.status || 503).json({ message: error.message || 'Не удалось подготовить список учётных записей' });
    }

    const [users] = await db.execute(
      `SELECT * FROM users
       WHERE LOWER(login) = ?
          OR LOWER(REPLACE(REPLACE(login, ' ', ''), '.', '')) = ?
          OR LOWER(full_name) = ?
          OR LOWER(REPLACE(REPLACE(full_name, ' ', ''), '.', '')) = ?`,
      [normalizedLogin, normalizedLogin.replace(/[\s.]/g, ''), normalizedLogin, normalizedLogin.replace(/[\s.]/g, '')]
    );

    if (users.length === 0) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    const user = users[0];

    if (!await isPasswordValid(passwordValue, user.password)) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    clearLoginAttempts(attemptKey);

    if (passwordNeedsUpgrade(user.password)) {
      await db.execute('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(passwordValue), user.id]);
    }

    const profile = await readProfileByLogin(user.login);

    res.json({
      message: 'Вход успешен',
      token: createAccessToken({ login: user.login, role: user.role }),
      user: {
        ...mapUser(user),
        position: profile.position || ''
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

module.exports = router;
