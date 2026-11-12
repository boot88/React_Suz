// Разбор сведений о посещении без внешних зависимостей.
// Коды (os/browser/device/source) хранятся в базе, а подписи для интерфейса
// выбираются на клиенте — так журнал не зависит от языка администратора.

const BOT_PATTERN = /(bot|crawler|spider|slurp|headlesschrome|phantomjs|selenium|webdriver|pingdom|uptime|monitoring|curl\/|wget\/|python-requests|go-http-client|node-fetch|lighthouse|pagespeed)/i;

const clip = (value, max = 255) => String(value ?? '')
  // eslint-disable-next-line no-control-regex -- User-Agent and referrer may contain control characters.
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, Math.max(0, max));

const normalizeIp = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ip = raw.replace(/^::ffff:/i, '');
  if (ip === '::1') return '127.0.0.1';
  return clip(ip, 64);
};

const parseUserAgent = (value) => {
  const ua = String(value || '');
  const isBot = BOT_PATTERN.test(ua);

  let os = 'other';
  if (/Windows NT 10\.0/i.test(ua)) os = 'windows';
  else if (/Windows NT 6\.[0-3]|Windows NT 5\./i.test(ua)) os = 'windows';
  else if (/Windows/i.test(ua)) os = 'windows';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'ios';
  else if (/Android/i.test(ua)) os = 'android';
  else if (/CrOS/i.test(ua)) os = 'chromeos';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macos';
  else if (/Linux|X11/i.test(ua)) os = 'linux';

  let browser = 'other';
  if (/YaBrowser/i.test(ua)) browser = 'yandex';
  else if (/SamsungBrowser/i.test(ua)) browser = 'samsung';
  else if (/Edg(?:e|A|iOS)?\//i.test(ua)) browser = 'edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'opera';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'chrome';
  else if (/Safari\//i.test(ua)) browser = 'safari';
  else if (/MSIE|Trident/i.test(ua)) browser = 'ie';

  let device = 'desktop';
  if (isBot) device = 'bot';
  else if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/i.test(ua)) device = 'mobile';

  return { os, browser, device, isBot };
};

const normalizeHost = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  try {
    const url = new URL(text.includes('://') ? text : `http://${text}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return text.split('/')[0].split(':')[0].replace(/^www\./, '');
  }
};

const SOURCE_RULES = [
  { source: 'yandex', kind: 'search', test: (host) => host === 'ya.ru' || host.endsWith('.ya.ru') || /(^|\.)yandex\./.test(host) },
  { source: 'google', kind: 'search', test: (host) => /^(?:www\.)?google\.[a-z.]+$/.test(host) },
  { source: 'bing', kind: 'search', test: (host) => /^(?:www\.)?bing\.com$/.test(host) },
  { source: 'duckduckgo', kind: 'search', test: (host) => /^(?:www\.)?duckduckgo\.com$/.test(host) },
  { source: 'rambler', kind: 'search', test: (host) => /(^|\.)rambler\.ru$/.test(host) },
  { source: 'vk', kind: 'social', test: (host) => /(^|\.)vk\.(?:com|ru)$/.test(host) },
  { source: 'ok', kind: 'social', test: (host) => /(^|\.)ok\.ru$/.test(host) },
  { source: 'telegram', kind: 'social', test: (host) => /(^|\.)t\.me$|(^|\.)telegram\.(?:me|org|dog)$/.test(host) },
  { source: 'mail', kind: 'external', test: (host) => /(^|\.)mail\.ru$/.test(host) },
  { source: 'nioch', kind: 'external', test: (host) => /(^|\.)nioch\.nsc\.ru$/.test(host) }
];

const detectSource = (referrer, selfHost = '') => {
  const raw = String(referrer || '').trim();
  if (!raw) return { source: 'direct', kind: 'direct' };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { source: 'direct', kind: 'direct' };
  }
  if (!/^https?:$/i.test(url.protocol)) return { source: 'direct', kind: 'direct' };

  const host = normalizeHost(url.hostname);
  if (!host) return { source: 'direct', kind: 'direct' };

  const ownHost = normalizeHost(selfHost);
  if (ownHost && host === ownHost) return { source: 'internal', kind: 'internal' };

  const rule = SOURCE_RULES.find((item) => item.test(host));
  if (rule) return { source: rule.source, kind: rule.kind };

  return { source: `site:${clip(host, 100)}`, kind: 'external' };
};

const cleanPath = (value, max = 512) => {
  let text = String(value || '').trim();
  if (!text) return '/';
  if (!text.startsWith('/')) text = `/${text}`;
  text = text.split('#')[0];
  const [pathname, rawQuery = ''] = text.split('?');
  let query = '';
  try {
    const params = new URLSearchParams(rawQuery);
    params.delete('access_token');
    params.delete('mt');
    query = params.toString();
  } catch {
    query = '';
  }
  const result = query ? `${pathname}?${query}` : pathname;
  return clip(result, max) || '/';
};

const normalizeUtm = (value = {}) => ({
  source: clip(value?.source || value?.utm_source || '', 120) || null,
  medium: clip(value?.medium || value?.utm_medium || '', 120) || null,
  campaign: clip(value?.campaign || value?.utm_campaign || '', 160) || null
});

// Календарный день Новосибирска (UTC+7) в формате YYYY-MM-DD.
const getVisitorDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Novosibirsk', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);

// Начало календарного дня Новосибирска в миллисекундах UTC.
const getVisitorDayStart = (date = new Date()) => {
  const time = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(time)) return NaN;
  const shifted = new Date(time + 7 * 3600000);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - 7 * 3600000;
};

module.exports = {
  BOT_PATTERN,
  clip,
  normalizeIp,
  parseUserAgent,
  normalizeHost,
  detectSource,
  cleanPath,
  normalizeUtm,
  getVisitorDay,
  getVisitorDayStart
};
