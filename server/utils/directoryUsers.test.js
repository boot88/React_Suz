const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planProvisionedUsers,
  isSamePerson,
  getShortPersonName,
  isServiceDirectoryAccount
} = require('./directoryUsers');

const employee = (login, fullName, extra = {}) => ({
  login,
  password: 'hash',
  role: 'employee',
  full_name: fullName,
  provisioned_from_directory: 1,
  ...extra
});

// Нормализатор ФИО удаляет цифры, поэтому имена формируются из кириллических
// букв — иначе «Сотрудник 1» и «Сотрудник 2» считались бы одним человеком.
const LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ';
const personName = (index) => {
  let rest = index;
  let suffix = '';
  do {
    suffix = LETTERS[rest % LETTERS.length] + suffix;
    rest = Math.floor(rest / LETTERS.length);
  } while (rest > 0);
  return `Тестов${suffix} Тест Тестович`;
};

const phoneRow = (fullName, department = 'ЛЭАСМ') => ({
  full_name: fullName,
  position: 'снс',
  department,
  room: '312',
  internal_phone: '1-286',
  external_phone: '330-95-24',
  email: ''
});

test('treats a missing patronymic as the same person', () => {
  assert.equal(isSamePerson('Олейник Ирина Владимировна', 'Олейник Ирина'), true);
  assert.equal(isSamePerson('Олейник Иван Иванович', 'Олейник Ирина Владимировна'), false);
  assert.equal(isSamePerson('Петрова Анна', 'Петрова Аннамария'), false);
  assert.equal(getShortPersonName('Олейник Ирина Владимировна'), 'Олейник И.В.');
});

test('reuses existing logins instead of recreating accounts', () => {
  const existingUsers = [
    employee('олеиник и.в', 'Олейник Ирина Владимировна'),
    employee('олеиник и.и', 'Олейник Иван Иванович'),
    employee('повисок е.в', 'Повисок Евгений Вячеславович', { role: 'admin' })
  ];
  const plan = planProvisionedUsers({
    phoneRows: [
      phoneRow('Олейник Ирина Владимировна'),
      phoneRow('Олейник Иван Иванович'),
      phoneRow('Повисок Евгений Вячеславович', 'АХО')
    ],
    existingUsers,
    adminNames: ['Повисок Е.В.'],
    actingLogin: 'повисок е.в',
    activeSessionLogins: ['олеиник и.и']
  });

  assert.deepEqual(plan.desiredUsers.map((item) => item.login).sort(), ['олеиник и.в', 'олеиник и.и', 'повисок е.в']);
  assert.equal(plan.reusedLogins, 3);
  assert.deepEqual(plan.deletedLogins, []);
  assert.equal(plan.desiredUsers.find((item) => item.login === 'повисок е.в').role, 'admin');
});

test('keeps an account when the source temporarily drops the patronymic', () => {
  // Ранее это меняло логин и удаляло аккаунт сотрудника.
  const plan = planProvisionedUsers({
    phoneRows: [phoneRow('Олейник Ирина'), phoneRow('Олейник Иван Иванович')],
    existingUsers: [
      employee('олеиник и.в', 'Олейник Ирина Владимировна'),
      employee('олеиник и.и', 'Олейник Иван Иванович')
    ],
    adminNames: [],
    actingLogin: '',
    activeSessionLogins: []
  });

  assert.deepEqual(plan.desiredUsers.map((item) => item.login).sort(), ['олеиник и.в', 'олеиник и.и']);
  assert.deepEqual(plan.deletedLogins, []);
});

test('skips deletions when the directory snapshot is incomplete', () => {
  const existingUsers = Array.from({ length: 60 }, (_, index) => employee(`user-${index}`, personName(index)));
  const plan = planProvisionedUsers({
    phoneRows: [phoneRow('Олейник Ирина Владимировна')],
    existingUsers,
    adminNames: [],
    actingLogin: '',
    activeSessionLogins: [],
    minUsers: 50
  });

  assert.deepEqual(plan.deletedLogins, []);
  assert.equal(plan.skippedDeletions.length, 60);
});

test('never deletes admins, managers, the acting user or active sessions', () => {
  const desiredNames = Array.from({ length: 10 }, (_, index) => personName(index));
  const existingUsers = [
    ...desiredNames.map((name, index) => employee(`user-${index}`, name)),
    // Аккаунты, которые не должны удаляться при обновлении справочника.
    employee('бывш-админ', 'Бывший Админ', { role: 'admin' }),
    employee('бывш-менеджер', 'Бывший Менеджер', { role: 'manager' }),
    employee('текущий админ', 'Текущий Админ'),
    employee('активная сессия', 'Активная Сессия'),
    employee('исчез', 'Исчез Из Справочника'),
    employee('не из справочника', 'Ручной Аккаунт', { provisioned_from_directory: 0 })
  ];

  const plan = planProvisionedUsers({
    phoneRows: desiredNames.map((name) => phoneRow(name)),
    existingUsers,
    adminNames: [],
    actingLogin: 'текущий админ',
    activeSessionLogins: ['активная сессия'],
    minUsers: 10,
    maxDeletionRatio: 0.5
  });

  assert.deepEqual(plan.deletedLogins, ['исчез']);
  assert.equal(plan.removalCandidates, 1);
  ['бывш-админ', 'бывш-менеджер', 'текущий админ', 'активная сессия', 'не из справочника']
    .forEach((login) => assert.ok(!plan.deletedLogins.includes(login), `${login} не должен удаляться`));
  assert.deepEqual(plan.skippedDeletions, []);
});

test('blocks a mass deletion instead of wiping the directory', () => {
  const existingUsers = Array.from({ length: 100 }, (_, index) => employee(`user-${index}`, personName(index)));
  const phoneRows = existingUsers.slice(0, 60).map((user) => phoneRow(user.full_name));

  const plan = planProvisionedUsers({
    phoneRows,
    existingUsers,
    adminNames: [],
    actingLogin: '',
    activeSessionLogins: [],
    minUsers: 50,
    maxDeletionRatio: 0.05
  });

  assert.deepEqual(plan.deletedLogins, []);
  assert.equal(plan.skippedDeletions.length, 40);
});

test('does not demote the administrator who runs the sync', () => {
  const plan = planProvisionedUsers({
    phoneRows: [phoneRow('Иванов Иван Иванович')],
    existingUsers: [employee('иванов и.и', 'Иванов Иван Иванович', { role: 'admin' })],
    adminNames: [],
    actingLogin: 'иванов и.и',
    activeSessionLogins: [],
    minUsers: 1
  });

  assert.equal(plan.desiredUsers[0].role, 'admin');
});

// «Администратор» — служебная запись, которую сервер заводит сам. В списке
// выбора на входе её быть не должно: там выбирают фамилию из справочника.
test('hides the automatic administrator account from the login directory', () => {
  const options = { serviceLogin: 'admin', serviceName: 'Администратор' };

  assert.equal(isServiceDirectoryAccount({ login: 'admin', full_name: 'Администратор' }, options), true);
  assert.equal(isServiceDirectoryAccount({ login: 'ADMIN', full_name: 'Кто-то другой' }, options), true);
  assert.equal(isServiceDirectoryAccount({ login: 'кто-то другой', full_name: 'администратор' }, options), true);
  assert.equal(isServiceDirectoryAccount({ login: 'повисок е.в', full_name: 'Повисок Евгений Вячеславович' }, options), false);
  assert.equal(isServiceDirectoryAccount({ login: 'андреев р.в', full_name: 'Андреев Родион Викторович' }, options), false);
});

test('keeps every account listed when the service account is not configured', () => {
  const account = { login: 'admin', full_name: 'Администратор' };

  assert.equal(isServiceDirectoryAccount(account), false);
  assert.equal(isServiceDirectoryAccount(account, {}), false);
  assert.equal(isServiceDirectoryAccount(account, { serviceLogin: 'admin' }), true);
});
