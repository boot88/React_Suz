import {
  WELCOME_NOTICE_DURATION_MS,
  buildWelcomeGreeting,
  clearWelcomeGreeting,
  getWelcomeGreetingKey,
  hasSeenWelcomeGreeting,
  markWelcomeGreetingSeen,
  pickFirstName
} from './welcomeGreeting';

// 15 сентября 2026 года — вторник, это пример из требования к приветствию.
const TUESDAY_SEPTEMBER_15 = new Date('2026-09-15T05:00:00Z');

// Сокращённые названия месяцев — надпись должна использовать именно их.
const RU_MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

test('приветствие собирается в одну строку с именем сотрудника и датой', () => {
  expect(buildWelcomeGreeting('Евгений', false, TUESDAY_SEPTEMBER_15))
    .toBe('Добро пожаловать, Евгений! Сегодня вторник, 15 сент.');
});

test('надпись не содержит переносов строк', () => {
  const notice = buildWelcomeGreeting('Евгений', false, TUESDAY_SEPTEMBER_15);
  expect(notice).not.toMatch(/[\r\n\t]/);
});

test('из ФИО попадает имя, а не фамилия (в базе формат «Фамилия Имя Отчество»)', () => {
  expect(pickFirstName('Повисок Евгений Вячеславович')).toBe('Евгений');
  expect(pickFirstName('Абашева Анна Юрьевна')).toBe('Анна');
  expect(pickFirstName('Агафонцев Александр Михайлович')).toBe('Александр');
  expect(pickFirstName('Сухов Максим')).toBe('Максим');
  expect(pickFirstName('Валуца Николае')).toBe('Николае');
  expect(pickFirstName('  Повисок   Евгений   Вячеславович  ')).toBe('Евгений');
});

test('порядок «Имя Фамилия» тоже распознаётся', () => {
  expect(pickFirstName('Евгений Петров')).toBe('Евгений');
  expect(pickFirstName('Evgeny Petrov')).toBe('Evgeny');
});

test('приветствие с реальным ФИО содержит только имя', () => {
  expect(buildWelcomeGreeting('Повисок Евгений Вячеславович', false, TUESDAY_SEPTEMBER_15))
    .toBe('Добро пожаловать, Евгений! Сегодня вторник, 15 сент.');
  expect(buildWelcomeGreeting('Абашева Анна Юрьевна', false, TUESDAY_SEPTEMBER_15))
    .toBe('Добро пожаловать, Анна! Сегодня вторник, 15 сент.');
  expect(buildWelcomeGreeting('Evgeny Petrov', true, TUESDAY_SEPTEMBER_15))
    .toBe('Welcome, Evgeny! Today is Tuesday, Sep 15');
});

test('фамилия и отчество в надпись не попадают', () => {
  const notice = buildWelcomeGreeting('Повисок Евгений Вячеславович', false, TUESDAY_SEPTEMBER_15);
  expect(notice).not.toContain('Повисок');
  expect(notice).not.toContain('Вячеславович');
});

test('короткая форма «Фамилия И.О.» и служебные аккаунты — обращение без имени', () => {
  expect(pickFirstName('Повисок Е.В.')).toBe('коллега');
  expect(pickFirstName('Повисок Е')).toBe('коллега');
  expect(pickFirstName('Сухов')).toBe('коллега');
  expect(pickFirstName('Администратор')).toBe('коллега');
  expect(pickFirstName('admin')).toBe('коллега');
  expect(pickFirstName('admin', true)).toBe('colleague');
});

test('собирает английский вариант приветствия', () => {
  expect(buildWelcomeGreeting('Evgeny', true, TUESDAY_SEPTEMBER_15))
    .toBe('Welcome, Evgeny! Today is Tuesday, Sep 15');
});

test('название месяца всегда сокращено', () => {
  RU_MONTHS_SHORT.forEach((month, index) => {
    const notice = buildWelcomeGreeting('Евгений', false, new Date(Date.UTC(2026, index, 15, 5, 0, 0)));
    expect(notice).toMatch(new RegExp(`^Добро пожаловать, Евгений! Сегодня [а-яё]+, 15 ${month.replace('.', '\\.')}$`));
  });
});

test('подставляет запасное обращение без имени', () => {
  expect(buildWelcomeGreeting('   ', false, TUESDAY_SEPTEMBER_15))
    .toBe('Добро пожаловать, коллега! Сегодня вторник, 15 сент.');
  expect(buildWelcomeGreeting(undefined, true, TUESDAY_SEPTEMBER_15))
    .toBe('Welcome, colleague! Today is Tuesday, Sep 15');
});

test('приветствие висит 3 секунды', () => {
  expect(WELCOME_NOTICE_DURATION_MS).toBe(3000);
});

test('приветствие показывается один раз за сеанс входа', () => {
  sessionStorage.clear();
  expect(hasSeenWelcomeGreeting('Ivanov')).toBe(false);

  markWelcomeGreetingSeen('Ivanov');
  expect(hasSeenWelcomeGreeting('Ivanov')).toBe(true);
  expect(hasSeenWelcomeGreeting('ivanov')).toBe(true);
  expect(hasSeenWelcomeGreeting('petrov')).toBe(false);

  clearWelcomeGreeting('Ivanov');
  expect(hasSeenWelcomeGreeting('Ivanov')).toBe(false);
});

test('ключ показа приветствия не зависит от регистра логина', () => {
  expect(getWelcomeGreetingKey('Evgeny')).toBe(getWelcomeGreetingKey(' evgeny '));
});

test('повторный вход за день приветствует по имени на выбранном языке', () => {
  expect(buildWelcomeGreeting('Повисок Евгений Вячеславович', false, TUESDAY_SEPTEMBER_15, true))
    .toBe('С возвращением, Евгений');
  expect(buildWelcomeGreeting('Evgeny Petrov', true, TUESDAY_SEPTEMBER_15, true))
    .toBe('Welcome back, Evgeny');
});

test('дата первого приветствия учитывает полночь Новосибирска', () => {
  expect(buildWelcomeGreeting('Евгений', false, new Date('2026-09-30T17:00:00Z')))
    .toBe('Добро пожаловать, Евгений! Сегодня четверг, 1 окт.');
});

test('сохранённый сеанс снова показывает обычное приветствие в новом дне', () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date('2026-09-30T16:59:59Z'));
    markWelcomeGreetingSeen('alice');
    expect(hasSeenWelcomeGreeting('alice')).toBe(true);
    jest.setSystemTime(new Date('2026-09-30T17:00:00Z'));
    expect(hasSeenWelcomeGreeting('alice')).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
