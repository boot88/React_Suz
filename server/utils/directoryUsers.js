// server/utils/directoryUsers.js
// Планирование учётных записей по справочнику сотрудников.
//
// Раньше логины генерировались из ФИО заново на каждом обновлении и зависели от
// порядка/состава записей во внешнем источнике. Любое изменение состава меняло
// логины, из-за чего аккаунты удалялись и создавались заново: сотрудник терял
// пароль, его сессия становилась недействительной (выброс на страницу входа).
// Здесь логин существующего сотрудника переиспользуется, а удаление аккаунтов
// ограничено защитными условиями.

const normalizeLogin = (value = '') => String(value || '').trim().toLowerCase();

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

// Совпадение «короткого» имени администратора («Повисок Е.В.») с полным ФИО
// из справочника («Повисок Евгений Вячеславович»): фамилия совпадает, а
// каждую инициал в коротком имени сравниваем с началом соответствующей части.
const matchesAdminShortName = (fullName = '', adminName = '') => {
  const personParts = getNameParts(fullName).map((part) => part.toLowerCase());
  const adminParts = getNameParts(adminName).map((part) => part.replace(/\./g, '').toLowerCase());
  if (!personParts.length || !adminParts.length) return false;
  if (adminParts[0] !== personParts[0]) return false;
  if (adminParts.length === 1) return true;
  return adminParts.slice(1).every((initial, index) => {
    const personPart = personParts[index + 1];
    return Boolean(personPart) && personPart[0] === initial[0];
  });
};

const isConfiguredAdminName = (fullName = '', adminNames = []) => (
  adminNames.some((adminName) => (
    normalizePersonName(adminName) === normalizePersonName(fullName)
    || matchesAdminShortName(fullName, adminName)
  ))
);

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

// Имена считаются относящимися к одному человеку, если они совпадают с
// точностью до регистра и пунктуации либо отличаются только отчеством:
// источник иногда отдаёт ФИО без отчества, и это не должно пересоздавать аккаунт.
const isSamePerson = (left = '', right = '') => {
  const first = normalizePersonName(left);
  const second = normalizePersonName(right);
  if (!first || !second) return false;
  if (first === second) return true;
  const parts = [getNameParts(left).length, getNameParts(right).length].sort((a, b) => a - b);
  if (parts[1] - parts[0] !== 1) return false;
  const shorter = first.length <= second.length ? first : second;
  const longer = first.length <= second.length ? second : first;
  return shorter.length >= 6 && longer.startsWith(shorter);
};

const buildExistingIndex = (existingUsers = []) => {
  const byLogin = new Map();
  const byName = new Map();
  existingUsers.forEach((user) => {
    const login = normalizeLogin(user.login);
    if (login) byLogin.set(login, user);
    const name = normalizePersonName(user.full_name || '');
    if (name && !byName.has(name)) byName.set(name, user);
  });
  return { byLogin, byName };
};

const findExistingUserByName = (byName, fullName) => {
  const exact = byName.get(normalizePersonName(fullName));
  if (exact) return exact;
  for (const user of byName.values()) {
    if (isSamePerson(user.full_name, fullName)) return user;
  }
  return null;
};

// Собирает план синхронизации аккаунтов: какие записи создать/обновить и какие
// удалить. Удаление ограничено, чтобы неполный снимок справочника не уничтожил
// аккаунты работающих сотрудников (и не завершил их сессии).
const planProvisionedUsers = ({
  phoneRows = [],
  existingUsers = [],
  adminNames = [],
  actingLogin = '',
  activeSessionLogins = [],
  maxDeletionRatio = 0.05,
  minDeletions = 5,
  minUsers = 50
} = {}) => {
  const { byLogin, byName } = buildExistingIndex(existingUsers);
  const employeesByName = new Map();

  phoneRows.forEach((employee) => {
    const key = normalizePersonName(employee.full_name);
    if (!key) return;
    const current = employeesByName.get(key) || {
      ...employee,
      departments: [],
      positions: [],
      rooms: [],
      phones: [],
      externalPhones: []
    };
    current.departments.push(employee.department);
    current.positions.push(employee.position);
    current.rooms.push(employee.room);
    current.phones.push(employee.internal_phone);
    current.externalPhones.push(employee.external_phone);
    employeesByName.set(key, current);
  });

  const usedLogins = new Set();
  const desiredUsers = [];
  let reusedLogins = 0;

  const resolveLogin = (personName = '') => {
    const existing = findExistingUserByName(byName, personName);
    const existingLogin = existing ? normalizeLogin(existing.login) : '';
    if (existingLogin && !usedLogins.has(existingLogin)) {
      usedLogins.add(existingLogin);
      reusedLogins += 1;
      return existingLogin;
    }
    return createUniqueLogin(createBaseLoginFromName(personName), usedLogins);
  };

  [...employeesByName.values()].forEach((employee) => {
    const fullName = employee.full_name || employee.email || '';
    desiredUsers.push({
      login: resolveLogin(fullName),
      role: isConfiguredAdminName(fullName, adminNames) ? 'admin' : 'employee',
      full_name: employee.full_name,
      department: joinUniqueValues(employee.departments) || null,
      position: joinUniqueValues(employee.positions) || null,
      phone: joinUniqueValues(employee.phones) || null,
      external_phone: joinUniqueValues(employee.externalPhones) || null,
      room: joinUniqueValues(employee.rooms) || null
    });
  });

  adminNames.forEach((adminName) => {
    const exists = desiredUsers.some((item) => (
      normalizePersonName(item.full_name) === normalizePersonName(adminName)
      || matchesAdminShortName(item.full_name, adminName)
    ));
    if (exists) return;
    desiredUsers.push({
      login: resolveLogin(adminName),
      role: 'admin',
      full_name: adminName,
      department: null,
      position: null,
      phone: null,
      external_phone: null,
      room: null
    });
  });

  const acting = normalizeLogin(actingLogin);
  const actingUser = acting ? byLogin.get(acting) : null;
  if (actingUser && ['admin', 'manager'].includes(String(actingUser.role || '').toLowerCase())) {
    // Текущий администратор не теряет права во время собственного обновления:
    // смена роли завершила бы его сессию прямо во время операции.
    const actingEntry = desiredUsers.find((item) => normalizeLogin(item.login) === acting);
    if (actingEntry) actingEntry.role = String(actingUser.role).toLowerCase();
  }

  const desiredLogins = new Set(desiredUsers.map((item) => normalizeLogin(item.login)));
  const protectedLogins = new Set([acting, ...activeSessionLogins.map(normalizeLogin)].filter(Boolean));

  const removalCandidates = existingUsers.filter((user) => {
    const login = normalizeLogin(user.login);
    if (!login || desiredLogins.has(login)) return false;
    if (Number(user.provisioned_from_directory) !== 1) return false;
    if (protectedLogins.has(login)) return false;
    const role = String(user.role || '').toLowerCase();
    return role !== 'admin' && role !== 'manager';
  });

  // Массовое удаление (например, из-за неполной загрузки или смены формата
  // логинов) блокируется, но обычные увольнения в небольшой партии проходят.
  const maxDeletions = Math.max(Math.max(1, minDeletions), Math.floor(existingUsers.length * maxDeletionRatio));
  const canDelete = desiredUsers.length >= minUsers && removalCandidates.length <= maxDeletions;

  return {
    desiredUsers,
    reusedLogins,
    deletedLogins: canDelete ? removalCandidates.map((user) => user.login) : [],
    skippedDeletions: canDelete ? [] : removalCandidates.map((user) => ({ login: user.login, full_name: user.full_name })),
    removalCandidates: removalCandidates.length
  };
};

// Служебный аккаунт администратора («Администратор», логин из MANAGER_LOGIN)
// создаётся сервером автоматически и человеком из справочника не является.
// В списках выбора на страницах входа он не нужен: записи справочника там
// подставляются вместо фамилии сотрудника, а техническая строка только
// сбивает с толку и легко выбирается по ошибке.
const isServiceDirectoryAccount = (account = {}, { serviceLogin = '', serviceName = '' } = {}) => {
  const login = normalizeLogin(account.login);
  const configuredLogin = normalizeLogin(serviceLogin);
  if (login && configuredLogin && login === configuredLogin) return true;
  const fullName = String(account.full_name || '').trim().toLowerCase().replace(/ё/g, 'е');
  const configuredName = String(serviceName || '').trim().toLowerCase().replace(/ё/g, 'е');
  return Boolean(fullName && configuredName && fullName === configuredName);
};

module.exports = {
  normalizeLogin,
  normalizePersonName,
  getNameParts,
  getShortPersonName,
  joinUniqueValues,
  createBaseLoginFromName,
  matchesAdminShortName,
  isConfiguredAdminName,
  isServiceDirectoryAccount,
  createUniqueLogin,
  isSamePerson,
  buildExistingIndex,
  findExistingUserByName,
  planProvisionedUsers
};
