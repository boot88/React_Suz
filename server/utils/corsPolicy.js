// Правило доступа по источнику (CORS).
//
// Браузер отправляет заголовок Origin даже для запросов к тому же самому серверу,
// поэтому источником считается и собственный адрес сайта: адрес из адресной строки
// совпадает с заголовком Host запроса. Это работает и по IP, и по имени, и на
// любом порту (3000, 5000), поэтому пересборка при смене адреса не нужна.
//
// Дополнительные адреса (например, отдельный фронтенд) перечисляются через запятую
// в CORS_ORIGINS: CORS_ORIGINS=http://192.168.129.31:3000,https://example.org
const CLOUD_ORIGIN = 'https://react-suz.onrender.com';

const DEFAULT_PORTS = ['80', '443'];

// Разбирает адрес источника или заголовок Host: возвращает домен и явно указанный порт.
// Порт не подставляем: пустая строка означает «стандартный для схемы».
const parseOrigin = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;

  try {
    const url = new URL(text.includes('://') ? text : `http://${text}`);
    return { host: url.hostname, port: url.port };
  } catch {
    return null;
  }
};

const isSameHost = (left, right) => {
  if (!left || !right || left.host !== right.host) return false;
  if (left.port === right.port) return true;
  // Порт может быть не указан: в адресе браузера это 80 для http и 443 для https.
  if (!left.port) return DEFAULT_PORTS.includes(right.port);
  if (!right.port) return DEFAULT_PORTS.includes(left.port);
  return false;
};

const readCorsOrigins = (value) => String(value || '')
  .split(',')
  .map((item) => parseOrigin(item))
  .filter(Boolean);

const isAllowedCorsOrigin = (origin, host, options = {}) => {
  // Запросы без заголовка Origin (curl, серверные вызовы) CORS не касаются.
  if (!origin) return true;

  const originParts = parseOrigin(origin);
  if (!originParts) return false;

  // Свой адрес сервера: тот же домен и порт, с которого открыта страница.
  if (isSameHost(originParts, parseOrigin(host))) return true;

  if ((options.extraOrigins || []).some((allowed) => isSameHost(allowed, originParts))) return true;
  if (origin === CLOUD_ORIGIN) return true;

  if ((options.nodeEnv || process.env.NODE_ENV) === 'production') return false;

  // В разработке остаётся прежнее правило: localhost и частные сети.
  return (
    originParts.host === 'localhost'
    || originParts.host === '127.0.0.1'
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(originParts.host)
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(originParts.host)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(originParts.host)
  );
};

module.exports = {
  CLOUD_ORIGIN,
  parseOrigin,
  readCorsOrigins,
  isAllowedCorsOrigin
};
