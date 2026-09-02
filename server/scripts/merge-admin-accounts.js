// server/scripts/merge-admin-accounts.js
// Объединяет дублирующиеся аккаунты администраторов и сотрудников.
//
// Проблема: администраторы из ADMIN_FULL_NAMES («Повисок Е.В.») не совпадали
// с полными ФИО из телефонного справочника («Повисок Евгений Вячеславович»),
// поэтому провижининг создавал для одного человека два аккаунта:
//   - employee «повисок е.в»  (используется в чате сотрудников)
//   - admin   «повисок е.в-2» (используется для входа в админку)
// В результате переписки в чате и админ-панель были развязаны.
//
// Скрипт для каждой пары:
//   1) переносит ссылки (события заявок, просмотры, исполнители, профили,
//      сообщения чата, ленту, read-state) с админского логина на логин сотрудника;
//   2) повышает роль сотрудника до admin и копирует пароль админского аккаунта
//      (чтобы существующий вход в панель управления продолжал работать);
//   3) удаляет дублирующийся админский аккаунт.
// Повторный запуск безопасен (идемпотентен).

const path = require('path');
const db = require(path.join(__dirname, '..', 'config', 'database'));

const ADMIN_FULL_NAMES = [
  'Повисок Е.В.',
  'Андреев Р.В.',
  'Сальников Георгий Ефимович',
  'Польников Д.В.'
];

const normalizePersonName = (value = '') => String(value)
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^а-яa-z]/g, '');

const getNameParts = (fullName = '') => String(fullName)
  .replace(/\./g, ' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean);

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

const isAdminNameMatch = (fullName, adminName) => (
  normalizePersonName(adminName) === normalizePersonName(fullName)
  || matchesAdminShortName(fullName, adminName)
);

// «Короткое» имя администратора содержит инициалы («Повисок Е.В.»).
// Для полных имён («Сальников Георгий Ефимович») дубль-сотрудник не
// создавался бы провижинингом, поэтому fallback по имени не применяем.
const isShortAdminName = (fullName = '') => {
  const parts = getNameParts(fullName).slice(1);
  return parts.length > 0 && parts.every((part) => part.replace(/\./g, '').length <= 1);
};

const normalizeLogin = (value = '') => String(value || '').trim().toLowerCase();

const run = async () => {
  const [users] = await db.execute(
    'SELECT id, login, role, full_name, password, position, department, phone, room, provisioned_from_directory FROM users ORDER BY role, full_name'
  );

  const admins = users.filter((user) => user.role === 'admin');
  const employees = users.filter((user) => user.role === 'employee');

  const results = [];

  for (const admin of admins) {
    const adminLogin = normalizeLogin(admin.login);
    const isListedAdmin = ADMIN_FULL_NAMES.some((adminName) => isAdminNameMatch(admin.full_name, adminName));
    if (!isListedAdmin) continue;

    // Сначала ищем сотрудника с тем же логином-основой (для «…-2» это база без суффикса).
    let employee = null;
    if (adminLogin.endsWith('-2')) {
      const baseLogin = adminLogin.slice(0, -2);
      employee = employees.find((item) => normalizeLogin(item.login) === baseLogin) || null;
    }
    // Затем по совпадению ФИО сотрудника именно с именем текущего администратора
    // (а не со всем списком — иначе можно ошибочно слить разные пары).
    // Применяем только для «коротких» имён с инициалами.
    if (!employee && isShortAdminName(admin.full_name)) {
      employee = employees.find((item) => (
        isAdminNameMatch(item.full_name, admin.full_name)
        && normalizePersonName(item.full_name) !== normalizePersonName(admin.full_name)
      )) || null;
    }
    if (!employee) {
      results.push({ admin: admin.login, status: 'no-employee-duplicate', skipped: true });
      continue;
    }

    const employeeLogin = normalizeLogin(employee.login);
    if (employeeLogin === adminLogin) {
      results.push({ admin: admin.login, status: 'same-login', skipped: true });
      continue;
    }

    const migratedTables = [];

    // 1. Переносим ссылки на админский логин на логин сотрудника.
    const refs = [
      ['chat_messages', 'sender_login'],
      ['chat_read_state', 'user_login'],
      ['feed_posts', 'author_login'],
      ['feed_comments', 'author_login'],
      ['application_events', 'actor_login'],
      ['application_views', 'admin_login']
    ];
    for (const [table, column] of refs) {
      try {
        await db.execute(`UPDATE ${table} SET ${column} = ? WHERE LOWER(${column}) = ?`, [employeeLogin, adminLogin]);
        migratedTables.push(`${table}.${column}`);
      } catch (error) {
        console.warn(`Не удалось перенести ${table}.${column}:`, error.message);
      }
    }

    // 2. Исполнители/принявшие заявки.
    await db.execute('UPDATE application SET accepted_by = ? WHERE LOWER(accepted_by) = ?', [employeeLogin, adminLogin]);
    await db.execute('UPDATE application SET executor = ? WHERE LOWER(executor) = ?', [employeeLogin, adminLogin]);

    // 3. Профиль (employee_profiles.login — PRIMARY KEY, поэтому upsert).
    try {
      const [adminProfiles] = await db.execute('SELECT * FROM employee_profiles WHERE LOWER(login) = ?', [adminLogin]);
      if (adminProfiles.length) {
        const adminProfile = adminProfiles[0];
        await db.execute(
          `INSERT INTO employee_profiles (login, profile_json, avatar_stored_name, avatar_mime, avatar_size, avatar_updated_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             profile_json = VALUES(profile_json),
             avatar_stored_name = VALUES(avatar_stored_name),
             avatar_mime = VALUES(avatar_mime),
             avatar_size = VALUES(avatar_size),
             avatar_updated_at = VALUES(avatar_updated_at),
             updated_at = VALUES(updated_at)`,
          [employeeLogin, adminProfile.profile_json, adminProfile.avatar_stored_name, adminProfile.avatar_mime, adminProfile.avatar_size, adminProfile.avatar_updated_at, adminProfile.updated_at]
        );
        migratedTables.push('employee_profiles');
        await db.execute('DELETE FROM employee_profiles WHERE LOWER(login) = ?', [adminLogin]);
      }
    } catch (error) {
      console.warn('Не удалось перенести профиль:', error.message);
    }

    // 4. Повышаем роль сотрудника до admin и копируем пароль админского аккаунта,
    //    чтобы вход в панель управления продолжал работать с тем же паролем.
    await db.execute(
      'UPDATE users SET role = ?, password = ?, full_name = ?, position = COALESCE(position, ?), department = COALESCE(department, ?), phone = COALESCE(phone, ?), room = COALESCE(room, ?), provisioned_from_directory = ? WHERE id = ?',
      ['admin', admin.password, employee.full_name || admin.full_name, admin.position, admin.department, admin.phone, admin.room, Math.max(employee.provisioned_from_directory, admin.provisioned_from_directory), employee.id]
    );

    // 5. Удаляем дублирующийся админский аккаунт.
    await db.execute('DELETE FROM users WHERE id = ?', [admin.id]);

    results.push({
      admin: admin.login,
      employee: employeeLogin,
      status: 'merged',
      role: 'admin',
      migratedTables
    });
  }

  console.log('\n=== Результат объединения аккаунтов ===');
  console.log(JSON.stringify(results, null, 2));
  const merged = results.filter((item) => item.status === 'merged').length;
  console.log(`\nОбъединено аккаунтов: ${merged}`);
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Ошибка при объединении аккаунтов:', error);
    process.exit(1);
  });

