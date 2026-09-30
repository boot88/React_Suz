// server/utils/employeeDirectory.js
// Разбор внешнего телефонного справочника и его устойчивая загрузка.
//
// Источник отдаёт страницы нестабильно: соседние запросы возвращают
// перекрывающиеся выборки, из-за чего одиночный проход «теряет» часть
// сотрудников. Потерянная запись помечалась уволенной и её аккаунт удалялся,
// поэтому справочник загружается несколькими проходами с объединением
// результата до стабилизации набора записей.

const PHONE_BOOK_URL = process.env.PHONE_BOOK_URL || 'http://web3.nioch.nsc.ru/nioch/index.php/ru/kontakty/telefonnyj-spravochnik';
const MIN_SYNC_EMPLOYEES = Number(process.env.EMPLOYEE_SYNC_MIN_ROWS || 50);
const PHONE_BOOK_PAGE_SIZE = Number(process.env.PHONE_BOOK_PAGE_SIZE || 20);
const PHONE_BOOK_MAX_PAGES = Number(process.env.PHONE_BOOK_MAX_PAGES || 25);
const PHONE_BOOK_FETCH_CONCURRENCY = Number(process.env.PHONE_BOOK_FETCH_CONCURRENCY || 4);
const PHONE_BOOK_FETCH_RETRIES = Number(process.env.PHONE_BOOK_FETCH_RETRIES || 2);
const PHONE_BOOK_REQUEST_TIMEOUT_MS = Number(process.env.PHONE_BOOK_REQUEST_TIMEOUT_MS || 15000);
const EMPLOYEE_SYNC_SWEEPS = Number(process.env.EMPLOYEE_SYNC_SWEEPS || 3);
// Доля активных записей, ниже которой снимок считается неполным и обновление
// отменяется: иначе частично загруженный справочник «увольняет» всех остальных.
const EMPLOYEE_SYNC_MIN_RATIO = Number(process.env.EMPLOYEE_SYNC_MIN_RATIO || 0.9);

const decodeHtmlEntities = (value = '') => String(value)
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const cleanText = (value = '') => decodeHtmlEntities(String(value)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const normalizeValue = (value = '') => cleanText(value).replace(/^[-–—]+$/, '').trim();

const normalizeSourceKeyPart = (value = '') => normalizeValue(value).toLowerCase().replace(/\s+/g, ' ');

const createEmployeeIdentity = (employee) => [
  employee.full_name || '',
  employee.department || ''
].map(normalizeSourceKeyPart).filter(Boolean).join('|');

const createSourceKey = (employee) => createEmployeeIdentity(employee) || [
  employee.full_name || '',
  employee.room || '',
  employee.internal_phone || '',
  employee.external_phone || '',
  employee.email || ''
].map(normalizeSourceKeyPart).filter(Boolean).join('|');

const buildPhoneBookPageUrl = (start = 0) => {
  const pageUrl = new URL(PHONE_BOOK_URL);
  if (start > 0) pageUrl.searchParams.set('start', String(start));
  return pageUrl.toString();
};

const extractTableRows = (html = '') => {
  const tableMatch = String(html).match(/<table[^>]*id=['"]cardnList['"][^>]*>[\s\S]*?<\/table>/i);
  const tableHtml = tableMatch ? tableMatch[0] : String(html);
  const bodyMatch = tableHtml.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/i);
  const rowsHtml = bodyMatch ? bodyMatch[0] : tableHtml;
  const rows = [];
  const rowMatches = rowsHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const rowHtml of rowMatches) {
    const cellMatches = rowHtml.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    const cells = cellMatches.map(normalizeValue);
    // В некоторых разделах источника колонка подразделения отсутствует,
    // поэтому фактическая строка содержит шесть ячеек, а не семь.
    if (cells.length >= 6 && cells[0] && !/^сотрудники$/i.test(cells[0])) {
      rows.push(cells);
    }
  }

  return rows;
};

const pickEmail = (cells) => {
  const joined = cells.join(' ');
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return email ? email[0] : '';
};

const rowToEmployee = (cells) => {
  const normalizedCells = cells.map(normalizeValue);
  // Часть представлений справочника добавляет отдельную порядковую колонку.
  if (/^\d+$/.test(normalizedCells[0] || '') && normalizedCells.length >= 7) {
    normalizedCells.shift();
  }
  const email = pickEmail(normalizedCells);
  const hasDepartmentColumn = normalizedCells.length >= 7;

  return {
    full_name: normalizedCells[0] || '',
    position: normalizedCells[1] || '',
    department: hasDepartmentColumn ? normalizedCells[2] || '' : '',
    room: normalizedCells[hasDepartmentColumn ? 3 : 2] || '',
    external_phone: normalizedCells[hasDepartmentColumn ? 4 : 3] || '',
    internal_phone: normalizedCells[hasDepartmentColumn ? 5 : 4] || '',
    // Антиспам-текст источника не является адресом электронной почты.
    email
  };
};

const parsePhoneBookEmployees = (html = '') => {
  const rows = extractTableRows(html);
  const employees = [];
  const seen = new Set();

  for (const row of rows) {
    const employee = rowToEmployee(row);
    employee.source_key = createSourceKey(employee);

    if (!employee.full_name || !employee.source_key || seen.has(employee.source_key)) continue;
    seen.add(employee.source_key);
    employees.push(employee);
  }

  return employees;
};

const fetchPhoneBookHtml = async (start = 0, options = {}) => {
  const {
    fetchImpl = fetch,
    timeoutMs = PHONE_BOOK_REQUEST_TIMEOUT_MS,
    retries = PHONE_BOOK_FETCH_RETRIES
  } = options;
  const pageUrl = buildPhoneBookPageUrl(start);
  let lastError;

  for (let attempt = 0; attempt <= Math.max(0, retries); attempt += 1) {
    try {
      const signal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
        ? AbortSignal.timeout(Math.max(1000, timeoutMs))
        : undefined;
      const response = await fetchImpl(pageUrl, {
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 EmployeeDirectorySync/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: 'http://web3.nioch.nsc.ru/'
        }
      });

      if (!response.ok) {
        throw new Error(`Источник справочника вернул HTTP ${response.status} для ${pageUrl}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Не удалось загрузить ${pageUrl}`);
};

// Последняя страница определяется по ссылкам пагинатора: источник на запросы
// за пределами списка повторно отдаёт последнюю страницу, поэтому «пустая»
// страница не является признаком конца справочника.
const findLastStart = (html = '', options = {}) => {
  const { pageSize = PHONE_BOOK_PAGE_SIZE, maxPages = PHONE_BOOK_MAX_PAGES } = options;
  const limit = Math.max(1, maxPages - 1) * pageSize;
  const starts = [...String(html).matchAll(/[?&]start=(\d+)/g)].map((match) => Number(match[1]));
  if (!starts.length) return limit;
  const aligned = Math.ceil(Math.max(...starts) / pageSize) * pageSize;
  return Math.min(Math.max(0, aligned), limit);
};

const buildPageStarts = (lastStart = 0, options = {}) => {
  const { pageSize = PHONE_BOOK_PAGE_SIZE, maxPages = PHONE_BOOK_MAX_PAGES } = options;
  const starts = [];
  for (let start = 0; start <= lastStart && starts.length < maxPages; start += pageSize) {
    starts.push(start);
  }
  return starts;
};

const mapWithConcurrency = async (items = [], limit = 1, worker) => {
  const queue = [...items];
  const size = Math.max(1, Math.min(Number(limit) || 1, queue.length || 1));
  const results = [];

  const run = async () => {
    while (queue.length) {
      const item = queue.shift();
      results.push(await worker(item));
    }
  };

  await Promise.all(Array.from({ length: size }, run));
  return results;
};

const collectPhoneBookSweep = async (starts = [], options = {}) => {
  const { concurrency = PHONE_BOOK_FETCH_CONCURRENCY } = options;
  const pages = new Map();
  const failedStarts = [];
  const pagesStats = [];

  await mapWithConcurrency(starts, concurrency, async (start) => {
    try {
      const html = await fetchPhoneBookHtml(start, options);
      const pageEmployees = parsePhoneBookEmployees(html);
      let added = 0;
      for (const employee of pageEmployees) {
        if (pages.has(employee.source_key)) continue;
        pages.set(employee.source_key, employee);
        added += 1;
      }
      pagesStats.push({ start, parsed: pageEmployees.length, added });
    } catch (error) {
      failedStarts.push({ start, message: error.message });
    }
  });

  pagesStats.sort((left, right) => left.start - right.start);
  return { pages, pagesStats, failedStarts };
};

// Загружает справочник несколькими проходами и объединяет результат: так
// компенсируются «перекрывающиеся» выборки источника, из-за которых одиночный
// проход теряет часть сотрудников.
const fetchAllPhoneBookEmployees = async (options = {}) => {
  const {
    sweeps = EMPLOYEE_SYNC_SWEEPS,
    pageSize = PHONE_BOOK_PAGE_SIZE,
    maxPages = PHONE_BOOK_MAX_PAGES
  } = options;
  const firstPageHtml = await fetchPhoneBookHtml(0, options);
  const lastStart = findLastStart(firstPageHtml, { pageSize, maxPages });
  const starts = buildPageStarts(lastStart, { pageSize, maxPages });

  const union = new Map();
  const failedStarts = [];
  let pagesStats = [];
  let usedSweeps = 0;
  let stable = false;
  let previousKeys = null;

  const mergeSweep = (sweep) => {
    sweep.pages.forEach((employee, key) => {
      if (!union.has(key)) union.set(key, employee);
    });
    sweep.failedStarts.forEach((item) => {
      if (!failedStarts.some((existing) => existing.start === item.start)) failedStarts.push(item);
    });
  };

  // Проходы не прерываются при совпадении результатов: источник может дважды
  // подряд отдать одинаково неполную выборку, поэтому объединяются все проходы.
  for (let index = 0; index < Math.max(1, sweeps); index += 1) {
    const sweep = await collectPhoneBookSweep(starts, options);
    usedSweeps += 1;
    pagesStats = sweep.pagesStats;
    mergeSweep(sweep);

    const keys = [...union.keys()].sort();
    stable = Boolean(previousKeys)
      && previousKeys.length === keys.length
      && previousKeys.every((key, position) => key === keys[position]);
    previousKeys = keys;

    // Если источник недоступен, повторные проходы бессмысленны.
    if (failedStarts.length > Math.max(2, Math.floor(starts.length * 0.25))) break;
  }

  // Страницы, где встретились повторы, означают «съехавшее» окно выборки:
  // такую страницу и следующую за ней перезапрашиваем, чтобы вернуть
  // пропущенную между окнами запись.
  const unstableStarts = [...new Set(pagesStats
    .filter((page) => page.added < page.parsed)
    .flatMap((page) => [page.start, page.start + pageSize])
    .filter((start) => starts.includes(start)))];

  if (unstableStarts.length && !failedStarts.length) {
    const retrySweep = await collectPhoneBookSweep(unstableStarts, options);
    mergeSweep(retrySweep);
  }

  return {
    employees: [...union.values()],
    pages: pagesStats,
    expectedPages: starts.length,
    lastStart,
    sweeps: usedSweeps,
    stable,
    failedStarts,
    retriedStarts: unstableStarts,
    pageSize
  };
};

// Предохранитель: обновление отменяется, если источник вернул неполный снимок,
// иначе отсутствующие в снимке сотрудники были бы помечены уволенными.
const assertDirectorySnapshot = ({
  incomingCount = 0,
  currentActiveCount = 0,
  minRows = MIN_SYNC_EMPLOYEES,
  minRatio = EMPLOYEE_SYNC_MIN_RATIO
} = {}) => {
  const incoming = Number(incomingCount) || 0;
  const current = Number(currentActiveCount) || 0;

  if (incoming < minRows) {
    const error = new Error(`Из источника получено слишком мало записей: ${incoming}. Проверьте формат страницы или доступ к справочнику.`);
    error.status = 422;
    error.parsed = incoming;
    throw error;
  }

  if (current >= minRows && incoming < Math.ceil(current * minRatio)) {
    const error = new Error(`Источник вернул ${incoming} записей, тогда как в справочнике активно ${current}. Обновление отменено, чтобы не помечать сотрудников уволенными из-за неполной загрузки. Повторите попытку позже.`);
    error.status = 409;
    error.parsed = incoming;
    error.activeBefore = current;
    throw error;
  }

  return { incoming, current };
};

module.exports = {
  PHONE_BOOK_URL,
  MIN_SYNC_EMPLOYEES,
  PHONE_BOOK_PAGE_SIZE,
  PHONE_BOOK_MAX_PAGES,
  PHONE_BOOK_FETCH_CONCURRENCY,
  PHONE_BOOK_FETCH_RETRIES,
  PHONE_BOOK_REQUEST_TIMEOUT_MS,
  EMPLOYEE_SYNC_SWEEPS,
  EMPLOYEE_SYNC_MIN_RATIO,
  decodeHtmlEntities,
  cleanText,
  normalizeValue,
  normalizeSourceKeyPart,
  createEmployeeIdentity,
  createSourceKey,
  buildPhoneBookPageUrl,
  extractTableRows,
  pickEmail,
  rowToEmployee,
  parsePhoneBookEmployees,
  fetchPhoneBookHtml,
  findLastStart,
  buildPageStarts,
  mapWithConcurrency,
  collectPhoneBookSweep,
  fetchAllPhoneBookEmployees,
  assertDirectorySnapshot
};
