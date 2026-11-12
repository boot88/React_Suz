export const VISIT_SOURCE_LABELS = {
  direct: 'Прямой заход',
  internal: 'Внутренний переход',
  yandex: 'Яндекс',
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  rambler: 'Rambler',
  mail: 'Mail.ru',
  vk: 'ВКонтакте',
  ok: 'Одноклассники',
  telegram: 'Telegram',
  nioch: 'Сайт НИОХ'
};

export const VISIT_ROLE_LABELS = {
  admin: 'Администратор',
  manager: 'Менеджер',
  employee: 'Сотрудник',
  guest: 'Гость'
};

export const VISIT_DEVICE_LABELS = {
  desktop: 'Компьютер',
  mobile: 'Телефон',
  tablet: 'Планшет',
  bot: 'Бот'
};

export const VISIT_OS_LABELS = {
  windows: 'Windows',
  macos: 'macOS',
  ios: 'iOS',
  android: 'Android',
  linux: 'Linux',
  chromeos: 'Chrome OS',
  other: 'Другое'
};

export const VISIT_BROWSER_LABELS = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  opera: 'Opera',
  yandex: 'Яндекс.Браузер',
  samsung: 'Samsung Internet',
  ie: 'Internet Explorer',
  other: 'Другой'
};

export const visitSourceLabel = (source = '') => {
  if (!source) return VISIT_SOURCE_LABELS.direct;
  if (VISIT_SOURCE_LABELS[source]) return VISIT_SOURCE_LABELS[source];
  return String(source).startsWith('site:') ? String(source).slice(5) : source;
};

export const visitRoleLabel = (role = '') => VISIT_ROLE_LABELS[role] || role || VISIT_ROLE_LABELS.guest;
export const visitDeviceLabel = (device = '') => VISIT_DEVICE_LABELS[device] || device || VISIT_DEVICE_LABELS.desktop;
export const visitOsLabel = (os = '') => VISIT_OS_LABELS[os] || os || VISIT_OS_LABELS.other;
export const visitBrowserLabel = (browser = '') => VISIT_BROWSER_LABELS[browser] || browser || VISIT_BROWSER_LABELS.other;

export const toVisitDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const formatVisitDateTime = (value, locale = 'ru-RU', timeZone = 'Asia/Novosibirsk') => {
  const date = toVisitDate(value);
  if (!date) return '—';
  return date.toLocaleString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone
  });
};

export const formatVisitTime = (value, locale = 'ru-RU', timeZone = 'Asia/Novosibirsk') => {
  const date = toVisitDate(value);
  if (!date) return '—';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });
};

export const formatVisitDay = (value, locale = 'ru-RU', timeZone = 'Asia/Novosibirsk') => {
  const date = toVisitDate(value);
  if (!date) return '—';
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone });
};

export const isVisitOnline = (lastSeenAt, now = Date.now(), threshold = 120000) => {
  const date = toVisitDate(lastSeenAt);
  if (!date) return false;
  const difference = now - date.getTime();
  return difference <= threshold && difference > -60000;
};

export const formatVisitDuration = (value, translate = (text) => text) => {
  const total = Math.max(0, Math.round(Number(value) || 0));
  if (total < 60) return `${total} ${translate('с')}`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const seconds = total % 60;
    return seconds
      ? `${minutes} ${translate('мин')} ${seconds} ${translate('с')}`
      : `${minutes} ${translate('мин')}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ${translate('ч')} ${rest} ${translate('мин')}` : `${hours} ${translate('ч')}`;
};

export const formatVisitNumber = (value, locale = 'ru-RU') => new Intl.NumberFormat(locale).format(Number(value) || 0);

// Дополняем дни без посещений нулями, чтобы график не «склеивал» неделю.
export const fillVisitDays = (daily = [], days = 7, now = Date.now()) => {
  const normalized = (Array.isArray(daily) ? daily : []).map((item) => ({
    day: String(item.day || ''),
    visits: Number(item.visits) || 0,
    visitors: Number(item.visitors) || 0
  })).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.day));
  if (!days) return normalized.sort((left, right) => left.day.localeCompare(right.day));

  const byDay = new Map(normalized.map((item) => [item.day, item]));
  const shiftedNow = new Date(now + 7 * 3600000);
  const todayKey = shiftedNow.toISOString().slice(0, 10);
  const end = new Date(`${todayKey}T00:00:00Z`);
  const result = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const key = new Date(end.getTime() - index * 86400000).toISOString().slice(0, 10);
    result.push(byDay.get(key) || { day: key, visits: 0, visitors: 0 });
  }
  return result;
};
