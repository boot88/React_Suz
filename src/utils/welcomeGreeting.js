// Приветствие при первом входе в систему:
// «Добро пожаловать, Евгений! Сегодня вторник, 15 сент.»
// Админ видит его при входе в админку, сотрудник — при входе в чат.
import { authFetch } from './authFetch';
import { API_BASE_URL } from './apiConfig';

export const WELCOME_GREETING_STORAGE_PREFIX = 'employeeGreetingSeen';
// 3 секунды — столько приветствие висит на экране (совпадает с длительностью
// анимации .admin-welcome-notice и .chat-welcome-notice в CSS).
export const WELCOME_NOTICE_DURATION_MS = 3000;

const FALLBACK_NAMES = { ru: 'коллега', en: 'colleague' };

// Дни недели и сокращённые месяцы держим своими таблицами: так надпись выглядит
// одинаково во всех браузерах и месяц всегда сокращён («15 сент.», «15 мая»).
const WEEKDAYS = {
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

const MONTHS_SHORT = {
  ru: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
};

// Ключ sessionStorage: приветствие показываем один раз за сеанс входа.
export const getWelcomeGreetingKey = (username = 'unknown') =>
  `${WELCOME_GREETING_STORAGE_PREFIX}:${String(username || 'unknown').trim().toLowerCase()}`;

const readSessionStorage = () => {
  try {
    return window.sessionStorage;
  } catch {
    // Приватный режим или недоступное хранилище — просто не помечаем показ.
    return null;
  }
};

const getGreetingDay = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Novosibirsk', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

export const hasSeenWelcomeGreeting = (username) => {
  const storage = readSessionStorage();
  if (!storage) return true;
  try {
    return storage.getItem(getWelcomeGreetingKey(username)) === getGreetingDay();
  } catch {
    return true;
  }
};

export const markWelcomeGreetingSeen = (username) => {
  const storage = readSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(getWelcomeGreetingKey(username), getGreetingDay());
    return true;
  } catch {
    return false;
  }
};

export const clearWelcomeGreeting = (username) => {
  const storage = readSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(getWelcomeGreetingKey(username));
  } catch {
    // Игнорируем: очищать нечего.
  }
};

// В базе ФИО сотрудников хранится как «Фамилия Имя Отчество» (см. server/routes/auth.js:
// getNameParts/getShortPersonName и генерацию логинов) — например «Повисок Евгений
// Вячеславович». Поэтому в приветствие берём именно имя: «Евгений», «Александр»,
// «Анна». Фамилия и отчество в надпись не попадают.
const INITIALS = /^[А-ЯЁA-Z]$/;                       // «Е» из короткой формы «Повисок Е.В.»
const PATRONYMIC = /(ович|евич|ьич|овна|евна|ична|инична)$/i;
// Однозначные фамильные окончания: нужны только чтобы распознать порядок «Имя Фамилия».
// Окончание «-ин/-ина» сюда не входит: «Валентин», «Константин», «Ирина», «Полина».
const STRONG_SURNAME = /(ов|ев|ёв)(а|ой|у|ым|ыми)?$|(ский|ская|цкий|цкая|ых|их|енко|ук|юк|як|ец)$/i;
// Слова, которые не являются личным именем: служебные аккаунты и подстановка логина.
const SERVICE_WORDS = new Set([
  'администратор', 'administrator', 'admin', 'менеджер', 'manager',
  'сотрудник', 'employee', 'пользователь', 'user'
]);

const isCyrillic = (word = '') => /[а-яё]/i.test(word);

// Имя из ФИО. Основной формат проекта — «Фамилия Имя Отчество», поэтому имя ищем
// вторым словом; порядок «Имя Фамилия» («Евгений Петров») определяем по однозначному
// фамильному окончанию. Отчество отбрасываем, инициалы («Е.В.») именем не считаем.
export const pickFirstName = (personName, isEnglish = false) => {
  const fallback = FALLBACK_NAMES[isEnglish ? 'en' : 'ru'];
  const words = String(personName || '')
    .trim()
    .split(/[\s.]+/)
    .filter(Boolean);
  const hasInitials = words.some((word) => INITIALS.test(word));
  const withoutInitials = words.filter((word) => !INITIALS.test(word));
  // Отчество стоит после имени, поэтому первое слово (фамилия) не трогаем:
  // «Ломанович Константин Александрович» остаётся с фамилией на месте.
  const nameParts = withoutInitials.filter((word, index) => index === 0 || !PATRONYMIC.test(word));

  if (nameParts.length >= 2) {
    const [first, second] = nameParts;
    // Записи латиницей («Evgeny Petrov») читаем как «имя фамилия».
    if (!isCyrillic(first) && !isCyrillic(second)) return first;
    if (!STRONG_SURNAME.test(first) && STRONG_SURNAME.test(second)) return first;  // Имя Фамилия
    return second;                                                                 // Фамилия Имя [Отчество]
  }

  const [only = ''] = nameParts;
  if (!only) return fallback;
  // «Повисок Е.В.» (одни инициалы), «Сухов» (фамилия без имени) и «admin» —
  // личного имени в данных нет, поэтому обращаемся как к коллеге.
  if (hasInitials || SERVICE_WORDS.has(only.toLowerCase()) || STRONG_SURNAME.test(only)) return fallback;
  return only;
};

// Вся надпись — одной строкой, без переноса:
// «Добро пожаловать, Евгений! Сегодня вторник, 15 сент.»
export const buildWelcomeGreeting = (displayName, isEnglish = false, date = new Date(), returning = false) => {
  const locale = isEnglish ? 'en' : 'ru';
  const name = pickFirstName(displayName, isEnglish);
  if (returning) return isEnglish ? `Welcome back, ${name}` : `С возвращением, ${name}`;
  const localDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Novosibirsk' }));
  const weekday = WEEKDAYS[locale][localDate.getDay()];
  const month = MONTHS_SHORT[locale][localDate.getMonth()];
  const day = localDate.getDate();
  return isEnglish
    ? `Welcome, ${name}! Today is ${weekday}, ${month} ${day}`
    : `Добро пожаловать, ${name}! Сегодня ${weekday}, ${day} ${month}`;
};

export const requestWelcomeGreeting = async (user, isEnglish = false) => {
  try {
    const response = await authFetch(`${API_BASE_URL}/auth/welcome`, {
      method: 'POST', headers: { Authorization: `Bearer ${user.accessToken}` }
    });
    if (!response.ok) return null;
    const { returning, date } = await response.json();
    return buildWelcomeGreeting(user.name || user.username, isEnglish, new Date(date), returning);
  } catch {
    return null;
  }
};
