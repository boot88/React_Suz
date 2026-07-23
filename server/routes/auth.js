const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const router = express.Router();
const db = require('../config/database');
const { getDatabaseDialect } = require('../utils/chatState');
const {
  getRequestValue,
  mergeProfileMaps
} = require('../utils/profileState');

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

const DEFAULT_EMPLOYEE_PASSWORD = String(process.env.DEFAULT_EMPLOYEE_PASSWORD || '');
const DEFAULT_ADMIN_PASSWORD = String(process.env.DEFAULT_ADMIN_PASSWORD || '');
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

const validateAvatar = (avatar = '') => {
  if (!avatar) return '';
  const match = String(avatar).match(/^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    const error = new Error('Аватар должен быть изображением PNG, JPG или WEBP');
    error.status = 400;
    throw error;
  }
  const size = Buffer.byteLength(match[2].replace(/\s/g, ''), 'base64');
  if (!size || size > MAX_AVATAR_BYTES) {
    const error = new Error('Размер сохранённого аватара не должен превышать 1 МБ');
    error.status = 413;
    throw error;
  }
  return avatar;
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
      password: hashPassword(isAdmin ? DEFAULT_ADMIN_PASSWORD : DEFAULT_EMPLOYEE_PASSWORD),
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
      password: hashPassword(DEFAULT_ADMIN_PASSWORD),
      full_name: adminName,
      department: null,
      position: null,
      phone: null,
      room: null
    });
  }

  const desiredLogins = desiredUsers.map((item) => item.login);

  await db.execute('DELETE FROM users WHERE login NOT IN (?)', [desiredLogins.length ? desiredLogins : ['__none__']]);

  for (const user of desiredUsers) {
    await db.execute(
      `INSERT INTO users (login, password, role, full_name, department, phone, room)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         password = VALUES(password),
         role = VALUES(role),
         full_name = VALUES(full_name),
         department = VALUES(department),
         phone = VALUES(phone),
         room = VALUES(room)`,
      [user.login, user.password, user.role, user.full_name, user.department, user.phone, user.room]
    );
  }

  lastProvisionAt = Date.now();

  const profiles = await readProfiles();
  desiredUsers.forEach((user) => {
    profiles[user.login] = {
      ...(profiles[user.login] || {}),
      full_name: user.full_name,
      department: user.department || '',
      phone: user.phone || '',
      room: user.room || '',
      position: user.position || profiles[user.login]?.position || '',
      websiteLanguage: profiles[user.login]?.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE,
      website: getStoredProfileWebsite(profiles[user.login]),
      statusText: DEFAULT_PROFILE_STATUS
    };
  });
  await writeProfiles(profiles);

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
    const dialect = getDatabaseDialect(db);
    if (!dialect) throw new Error('SQL client is unavailable');

    if (dialect === 'postgres') {
      await db.query(`CREATE TABLE IF NOT EXISTS employee_profiles (
        login VARCHAR(255) PRIMARY KEY,
        profile_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`);
    } else {
      await db.execute(`CREATE TABLE IF NOT EXISTS employee_profiles (
        login VARCHAR(255) PRIMARY KEY,
        profile_json LONGTEXT NOT NULL,
        updated_at DATETIME NOT NULL,
        INDEX idx_employee_profiles_updated (updated_at)
      )`);
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
  let rows;

  if (getDatabaseDialect(db) === 'postgres') {
    const result = await db.query('SELECT login, profile_json FROM employee_profiles');
    rows = result.rows;
  } else {
    [rows] = await db.execute('SELECT login, profile_json FROM employee_profiles');
  }

  return Object.fromEntries((rows || [])
    .map((row) => [normalizeLogin(row.login), parseProfileJson(row.profile_json)])
    .filter(([login, profile]) => login && profile));
};

const writeSqlProfile = async (login, profile = {}) => {
  if (!await ensureProfilesSqlSchema()) {
    const error = new Error('Постоянное хранилище профилей временно недоступно');
    error.status = 503;
    throw error;
  }
  const normalizedLogin = normalizeLogin(login);
  const updatedAt = new Date(profile.updatedAt || Date.now());
  const nextProfile = {
    ...profile,
    updatedAt: updatedAt.toISOString()
  };
  const params = [normalizedLogin, JSON.stringify(nextProfile), updatedAt];

  if (getDatabaseDialect(db) === 'postgres') {
    await db.query(
      `INSERT INTO employee_profiles (login, profile_json, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (login) DO UPDATE SET
         profile_json = EXCLUDED.profile_json,
         updated_at = EXCLUDED.updated_at`,
      params
    );
  } else {
    await db.execute(
      `INSERT INTO employee_profiles (login, profile_json, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         profile_json = VALUES(profile_json),
         updated_at = VALUES(updated_at)`,
      params
    );
  }

  return nextProfile;
};

const readProfilesArchive = async () => {
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

const writeProfilesArchive = async (items) => {
  await ensureProfilesStorage();
  const tempPath = `${profilesFilePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(items, null, 2), 'utf-8');
  await fs.rename(tempPath, profilesFilePath);
};

const readProfiles = async () => {
  const archiveProfiles = await readProfilesArchive();
  const sqlProfiles = await readSqlProfiles().catch((error) => {
    console.warn('Profile SQL read failed, using JSON archive:', error.message);
    return null;
  });
  if (!sqlProfiles) return archiveProfiles;

  const merged = mergeProfileMaps(archiveProfiles, sqlProfiles);
  const missingSqlLogins = Object.keys(archiveProfiles).filter((login) => !sqlProfiles[login]);
  if (missingSqlLogins.length) {
    Promise.all(missingSqlLogins.map((login) => writeSqlProfile(login, archiveProfiles[login])))
      .catch((error) => console.warn('Profile archive migration failed:', error.message));
  }
  return merged;
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
  const durableProfiles = Object.fromEntries(savedProfiles);
  await writeProfilesArchive(durableProfiles);
  return durableProfiles;
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
  profiles[normalizedLogin] = savedProfile;
  await writeProfilesArchive(profiles);
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
  room: user.room,
  display_name: getShortPersonName(user.full_name || user.login)
});


router.post('/provision-from-phone-book', async (req, res) => {
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
    const query = normalizeLogin(req.query?.query || '');
    const role = req.query?.role === 'admin' ? 'admin' : 'employee';
    const like = `${query}%`;
    const [users] = await db.execute(
      `SELECT id, login, role, full_name, department, phone, room
       FROM users
       WHERE role = ? AND (LOWER(full_name) LIKE ? OR LOWER(login) LIKE ?)
       ORDER BY full_name
       LIMIT 1000`,
      [role, like, like]
    );

    res.json({ suggestions: users.map(mapUser) });
  } catch (error) {
    console.error('Login suggestions error:', error);
    res.status(500).json({ message: 'Не удалось получить список сотрудников' });
  }
});


const ensureUsersProvisionedFromPhoneBook = async () => {
  const provisionTtlMs = 5 * 60 * 1000;
  if (lastProvisionAt && Date.now() - lastProvisionAt < provisionTtlMs) return null;
  if (!DEFAULT_EMPLOYEE_PASSWORD || !DEFAULT_ADMIN_PASSWORD) {
    if (!missingProvisionPasswordsWarned) {
      missingProvisionPasswordsWarned = true;
      console.warn('Automatic user provisioning is disabled until DEFAULT_EMPLOYEE_PASSWORD and DEFAULT_ADMIN_PASSWORD are configured.');
    }
    return null;
  }
  return provisionUsersFromPhoneBook();
};

// Регистрация сотрудника
router.post('/register', async (req, res) => {
  try {
    const { login, full_name, department, phone, room } = req.body;
    const normalizedLogin = normalizeLogin(login);
    const password = String(req.body?.password || '');

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
      'INSERT INTO users (login, password, role, full_name, department, phone, room) VALUES (?, ?, "employee", ?, ?, ?, ?)',
      [normalizedLogin, hashPassword(password), full_name || normalizedLogin, department || null, phone || null, room || null]
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
router.get('/employees', async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, login, role, full_name, department, phone, room FROM users WHERE role = "employee" ORDER BY login'
    );
    const profiles = await readProfiles();
    res.set('Cache-Control', 'no-store');
    res.json({
      employees: users.map((user) => {
        const mapped = mapUser(user);
        const extras = profiles[normalizeLogin(user.login)] || {};
        const avatarRevision = encodeURIComponent(extras.updatedAt || '');
        const avatar = extras.avatar
          ? `/api/auth/profile/${encodeURIComponent(user.login)}/avatar?rev=${avatarRevision}`
          : '';
        return {
          ...mapped,
          position: extras.position || '',
          bio: extras.bio || '',
          websiteLanguage: extras.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE,
          website: getStoredProfileWebsite(extras),
          statusText: extras.statusText || DEFAULT_PROFILE_STATUS,
          avatar,
          profile: {
            ...extras,
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
    res.set('Cache-Control', 'no-store');
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
        websiteLanguage: extras.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE,
        website: getStoredProfileWebsite(extras),
        statusText: extras.statusText || DEFAULT_PROFILE_STATUS,
        avatar: extras.avatar || '',
        preferences: extras.preferences && typeof extras.preferences === 'object' ? extras.preferences : {},
        updatedAt: extras.updatedAt || null
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
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'avatar')) {
      validateAvatar(req.body.avatar);
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

    const savedProfile = await mutateProfile(normalizedLogin, (currentProfile) => ({
      ...currentProfile,
      full_name: getRequestValue(req.body, 'full_name', currentProfile.full_name || normalizedLogin),
      department: getRequestValue(req.body, 'department', currentProfile.department || ''),
      phone: getRequestValue(req.body, 'phone', currentProfile.phone || ''),
      room: getRequestValue(req.body, 'room', currentProfile.room || ''),
      position: getRequestValue(req.body, 'position', currentProfile.position || ''),
      bio: getRequestValue(req.body, 'bio', currentProfile.bio || ''),
      websiteLanguage: getRequestValue(req.body, 'websiteLanguage', currentProfile.websiteLanguage || DEFAULT_PROFILE_WEBSITE_LANGUAGE),
      website: getRequestValue(
        req.body,
        'website',
        currentProfile.website || PROFILE_WEBSITE_BY_LANGUAGE[req.body?.websiteLanguage] || DEFAULT_PROFILE_WEBSITE
      ),
      statusText: getRequestValue(req.body, 'statusText', currentProfile.statusText || DEFAULT_PROFILE_STATUS),
      avatar: getRequestValue(req.body, 'avatar', currentProfile.avatar || ''),
      preferences: sanitizeProfilePreferences(currentProfile.preferences),
      updatedAt: new Date().toISOString()
    }));

    res.json({ message: 'Анкета обновлена', profile: savedProfile });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(error.status || 500).json({ message: error.message || 'Не удалось сохранить анкету' });
  }
});

router.put('/profile/preferences', async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(req.body?.login || '');
    const preferences = req.body?.preferences;
    if (!normalizedLogin) return res.status(400).json({ message: 'login обязателен' });
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

router.get('/profile/:login/avatar', async (req, res) => {
  try {
    const normalizedLogin = normalizeLogin(decodeURIComponent(req.params.login || ''));
    if (!normalizedLogin) return res.status(400).json({ message: 'login обязателен' });
    const profiles = await readProfiles();
    const avatar = String(profiles[normalizedLogin]?.avatar || '');
    const match = avatar.match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) return res.status(404).json({ message: 'Аватар не найден' });

    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return res.status(404).json({ message: 'Аватар не найден' });
    res.setHeader('Content-Type', match[1] || 'image/jpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(buffer);
  } catch (error) {
    console.error('Profile avatar get error:', error);
    return res.status(500).json({ message: 'Не удалось загрузить аватар' });
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

    await ensureUsersProvisionedFromPhoneBook();

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
