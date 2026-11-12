// Журнал посещений: приём отметок из браузера и административные отчёты.
const express = require('express');
const ExcelJS = require('exceljs');
const { requireAuth, requireRole, getBearerToken } = require('../middleware/auth');
const { resolveSession } = require('../utils/authSessions');
const {
  clip,
  normalizeIp,
  parseUserAgent,
  detectSource,
  cleanPath,
  normalizeUtm,
  getVisitorDayStart
} = require('../utils/visitorTracking');

const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const PING_MIN_INTERVAL_MS = 500;
const MAX_PAGES_PER_PING = 25;
const MAX_EXPORT_ROWS = 20000;
const PERIODS = ['1', '7', '30', '90', '365', 'all'];
const ROLES = ['admin', 'manager', 'employee', 'guest'];
const SORT_MODES = ['recent', 'duration', 'pages'];
const PAGE_SIZES = [10, 25, 50, 100];

const ROLE_LABELS = { admin: 'Администратор', manager: 'Менеджер', employee: 'Сотрудник', guest: 'Гость' };
const SOURCE_LABELS = {
  direct: 'Прямой заход', internal: 'Внутренний переход', yandex: 'Яндекс', google: 'Google',
  bing: 'Bing', duckduckgo: 'DuckDuckGo', rambler: 'Rambler', mail: 'Mail.ru', vk: 'ВКонтакте',
  ok: 'Одноклассники', telegram: 'Telegram', nioch: 'Сайт НИОХ'
};
const DEVICE_LABELS = { desktop: 'Компьютер', mobile: 'Телефон', tablet: 'Планшет', bot: 'Бот' };
const OS_LABELS = { windows: 'Windows', macos: 'macOS', ios: 'iOS', android: 'Android', linux: 'Linux', chromeos: 'Chrome OS', other: 'Другое' };
const BROWSER_LABELS = {
  chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', opera: 'Opera',
  yandex: 'Яндекс.Браузер', samsung: 'Samsung Internet', ie: 'Internet Explorer', other: 'Другой'
};

const sqlDate = (value) => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
const number = (value) => Number(value) || 0;
const escapeLike = (value) => String(value || '').replace(/[\\%_]/g, '\\$&');
const roleLabel = (role) => ROLE_LABELS[role || 'guest'] || role || ROLE_LABELS.guest;
const sourceLabel = (source) => {
  if (!source) return SOURCE_LABELS.direct;
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  return String(source).startsWith('site:') ? String(source).slice(5) : source;
};
const labelOf = (map, value, fallback) => map[value] || value || fallback;

const formatDurationRu = (value) => {
  const total = Math.max(0, Math.round(number(value)));
  if (total < 60) return `${total} с`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} мин ${total % 60} с`;
  return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
};

const formatDateRu = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { timeZone: 'Asia/Novosibirsk' });
};

const ensureSchema = (pool) => {
  let schemaPromise = null;
  return () => {
    if (!schemaPromise) {
      schemaPromise = (async () => {
        await pool.execute(`
          CREATE TABLE IF NOT EXISTS site_visits (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            session_id VARCHAR(64) NOT NULL,
            login VARCHAR(255) NULL,
            role VARCHAR(40) NULL,
            ip VARCHAR(64) NULL,
            user_agent VARCHAR(512) NULL,
            os VARCHAR(40) NULL,
            browser VARCHAR(40) NULL,
            device VARCHAR(20) NULL,
            source VARCHAR(120) NULL,
            source_kind VARCHAR(20) NULL,
            referrer VARCHAR(1024) NULL,
            utm_source VARCHAR(120) NULL,
            utm_medium VARCHAR(120) NULL,
            utm_campaign VARCHAR(160) NULL,
            landing_path VARCHAR(512) NULL,
            last_path VARCHAR(512) NULL,
            page_views INT UNSIGNED NOT NULL DEFAULT 0,
            active_seconds INT UNSIGNED NOT NULL DEFAULT 0,
            language VARCHAR(24) NULL,
            timezone VARCHAR(80) NULL,
            screen VARCHAR(24) NULL,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_site_visits_session (session_id),
            KEY idx_site_visits_started (started_at),
            KEY idx_site_visits_last_seen (last_seen_at),
            KEY idx_site_visits_login (login),
            KEY idx_site_visits_source (source)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.execute(`
          CREATE TABLE IF NOT EXISTS site_visit_pages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            visit_id BIGINT UNSIGNED NOT NULL,
            path VARCHAR(512) NOT NULL,
            title VARCHAR(255) NULL,
            views INT UNSIGNED NOT NULL DEFAULT 1,
            first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_site_visit_page (visit_id, path),
            KEY idx_site_visit_pages_path (path),
            KEY idx_site_visit_pages_last_seen (last_seen_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
      })().catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    return schemaPromise;
  };
};

const parseFilters = (query = {}, now = Date.now()) => {
  const period = PERIODS.includes(String(query.period || '')) ? String(query.period) : '7';
  const days = period === 'all' ? null : Number(period);
  const page = Math.min(100000, Math.max(1, parseInt(query.page, 10) || 1));
  const pageSize = PAGE_SIZES.includes(Number(query.pageSize)) ? Number(query.pageSize) : 25;
  const sort = SORT_MODES.includes(String(query.sort || '')) ? String(query.sort) : 'recent';
  const role = ROLES.includes(String(query.role || '')) ? String(query.role) : '';
  const online = ['1', 'true'].includes(String(query.online || ''));
  const search = clip(query.search, 100);
  if (String(query.search || '').length > 200) throw Object.assign(new Error('Слишком длинный поисковый запрос'), { status: 400 });
  const source = clip(query.source, 120);
  if (source && !/^[a-z0-9:._-]+$/i.test(source)) throw Object.assign(new Error('Некорректный источник'), { status: 400 });
  return {
    period,
    days,
    from: days ? getVisitorDayStart(now - (days - 1) * 86400000) : null,
    page,
    pageSize,
    sort,
    role,
    online,
    search,
    source,
    now
  };
};

const buildWhere = (filters) => {
  const clauses = [];
  const params = [];
  if (filters.from) {
    clauses.push('v.started_at >= ?');
    params.push(sqlDate(filters.from));
  }
  if (filters.source) {
    clauses.push('v.source = ?');
    params.push(filters.source);
  }
  if (filters.role === 'guest') {
    clauses.push("(v.role IS NULL OR v.role = '')");
  } else if (filters.role) {
    clauses.push('v.role = ?');
    params.push(filters.role);
  }
  if (filters.online) {
    clauses.push('v.last_seen_at >= ?');
    params.push(sqlDate(filters.now - ONLINE_WINDOW_MS));
  }
  if (filters.search) {
    const like = `%${escapeLike(filters.search)}%`;
    clauses.push('(v.login LIKE ? OR u.full_name LIKE ? OR v.ip LIKE ? OR v.source LIKE ? OR v.os LIKE ? OR v.browser LIKE ? OR v.device LIKE ?)');
    params.push(like, like, like, like, like, like, like);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
};

const sortSql = (sort) => {
  if (sort === 'duration') return 'v.active_seconds DESC, v.started_at DESC, v.id DESC';
  if (sort === 'pages') return 'v.page_views DESC, v.started_at DESC, v.id DESC';
  return 'v.started_at DESC, v.id DESC';
};

const normalizePages = (pages) => (Array.isArray(pages) ? pages.slice(0, MAX_PAGES_PER_PING) : [])
  .map((item) => {
    const path = cleanPath(typeof item === 'string' ? item : item?.path, 512);
    const title = clip(typeof item === 'object' ? item?.title : '', 255) || null;
    return { path, title };
  })
  .filter((item) => item.path);

const allowPing = (state, key, now) => {
  const previous = state.get(key);
  if (previous && now - previous < PING_MIN_INTERVAL_MS) return false;
  state.set(key, now);
  if (state.size > 5000) {
    for (const [itemKey, seenAt] of state.entries()) {
      if (now - seenAt > 10 * 60 * 1000) state.delete(itemKey);
    }
    if (state.size > 5000) state.clear();
  }
  return true;
};

const resolveIdentity = async (req) => {
  const token = getBearerToken(req);
  if (!token) return null;
  try {
    const identity = await resolveSession(token);
    if (!identity) return null;
    return {
      login: clip(identity.login, 255).toLowerCase(),
      role: clip(identity.role, 40).toLowerCase()
    };
  } catch {
    return null;
  }
};
const createVisitsRouter = (pool) => {
  const router = express.Router();
  const ensureVisitsSchema = ensureSchema(pool);
  const pingState = new Map();

  // Публичная отметка посещения. Токен не обязателен: гости тоже учитываются.
  router.post('/ping', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await ensureVisitsSchema();
      const body = req.body || {};
      if (body.isAutomation === true) return res.status(204).end();

      const uaInfo = parseUserAgent(req.headers['user-agent'] || '');
      if (uaInfo.isBot) return res.status(204).end();

      const sessionId = String(body.sessionId || '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return res.status(400).json({ error: 'Некорректная сессия' });

      const ip = normalizeIp(req.ip);
      const now = Date.now();
      const identity = await resolveIdentity(req);
      // Гостевой ping и следующий за ним ping с токеном — разные события:
      // иначе антифлуд отбросит вход, и сотрудник появится только через 30 секунд.
      if (!allowPing(pingState, `${ip}:${sessionId}:${identity?.login || 'guest'}`, now)) return res.status(204).end();

      const pages = normalizePages(body.pages);
      const path = cleanPath(body.path || pages[pages.length - 1]?.path || '/', 512);
      const activeSeconds = Math.min(86400, Math.max(0, Math.round(number(body.activeSeconds))));
      const referrer = clip(body.referrer || req.headers.referer || '', 1024) || null;
      const utm = normalizeUtm(body.utm);
      const source = detectSource(referrer || '', String(req.headers.host || '').split(':')[0]);
      const seenAt = new Date(now);
      const landingPath = pages[0]?.path || path;
      const lastPath = pages[pages.length - 1]?.path || path;

      const [result] = await pool.execute(`
        INSERT INTO site_visits
          (session_id, login, role, ip, user_agent, os, browser, device, source, source_kind,
           referrer, utm_source, utm_medium, utm_campaign, landing_path, last_path, page_views,
           active_seconds, language, timezone, screen, started_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          login = COALESCE(VALUES(login), login),
          role = COALESCE(VALUES(role), role),
          last_path = VALUES(last_path),
          page_views = page_views + VALUES(page_views),
          active_seconds = GREATEST(active_seconds, VALUES(active_seconds)),
          last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at))
      `, [
        sessionId,
        identity?.login || null,
        identity?.role || null,
        ip || null,
        clip(req.headers['user-agent'] || '', 512) || null,
        uaInfo.os,
        uaInfo.browser,
        uaInfo.device,
        source.source,
        source.kind,
        referrer,
        utm.source,
        utm.medium,
        utm.campaign,
        landingPath,
        lastPath,
        pages.length,
        activeSeconds,
        clip(body.language, 24) || null,
        clip(body.timezone, 80) || null,
        /^\d{2,5}x\d{2,5}$/.test(String(body.screen || '')) ? String(body.screen) : null,
        seenAt,
        seenAt
      ]);

      const visitId = Number(result.insertId);
      if (visitId && pages.length) {
        const placeholders = pages.map(() => '(?, ?, ?, 1, ?, ?)').join(', ');
        const pageParams = pages.flatMap((page) => [visitId, page.path, page.title, seenAt, seenAt]);
        await pool.execute(`
          INSERT INTO site_visit_pages (visit_id, path, title, views, first_seen_at, last_seen_at)
          VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE
            views = views + 1,
            title = COALESCE(VALUES(title), title),
            last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at))
        `, pageParams);
      }
      return res.status(204).end();
    } catch (error) {
      console.error('Ошибка журнала посещений:', error.message);
      return res.status(204).end();
    }
  });



  router.use(requireAuth, requireRole('admin', 'manager'));

  router.get('/', async (req, res) => {
    try {
      await ensureVisitsSchema();
      const now = Date.now();
      const filters = parseFilters(req.query, now);
      const where = buildWhere(filters);
      const baseFrom = 'FROM site_visits v LEFT JOIN users u ON LOWER(u.login) = v.login';
      const offset = (filters.page - 1) * filters.pageSize;
      const visitorKey = "CASE WHEN v.login IS NOT NULL AND v.login <> '' THEN CONCAT('u:', v.login) ELSE CONCAT('ip:', COALESCE(v.ip, '')) END";

      const [
        [summaryRows],
        [dailyRows],
        [sourceRows],
        [availableSourceRows],
        [deviceRows],
        [browserRows],
        [roleRows],
        [pageRows]
      ] = await Promise.all([
        pool.execute(`
          SELECT COUNT(*) AS visits,
            COUNT(DISTINCT ${visitorKey}) AS unique_visitors,
            SUM(CASE WHEN v.login IS NOT NULL AND v.login <> '' THEN 1 ELSE 0 END) AS identified,
            SUM(CASE WHEN v.login IS NULL OR v.login = '' THEN 1 ELSE 0 END) AS anonymous,
            SUM(CASE WHEN v.last_seen_at >= ? THEN 1 ELSE 0 END) AS online,
            SUM(CASE WHEN v.source_kind IN ('external', 'search', 'social') THEN 1 ELSE 0 END) AS external,
            SUM(v.page_views) AS page_views,
            SUM(v.active_seconds) AS total_seconds,
            AVG(v.active_seconds) AS avg_seconds
          ${baseFrom} ${where.sql}
        `, [sqlDate(now - ONLINE_WINDOW_MS), ...where.params]),
        pool.execute(`
          SELECT DATE_FORMAT(DATE_ADD(v.started_at, INTERVAL 7 HOUR), '%Y-%m-%d') AS day,
            COUNT(*) AS visits,
            COUNT(DISTINCT ${visitorKey}) AS visitors
          ${baseFrom} ${where.sql}
          GROUP BY day ORDER BY day ASC
        `, where.params),
        pool.execute(`
          SELECT v.source, v.source_kind, COUNT(*) AS visits
          ${baseFrom} ${where.sql}
          GROUP BY v.source, v.source_kind ORDER BY visits DESC, v.source ASC LIMIT 12
        `, where.params),
        pool.execute(`
          SELECT v.source, v.source_kind, COUNT(*) AS visits
          ${baseFrom} ${filters.from ? 'WHERE v.started_at >= ?' : ''}
          GROUP BY v.source, v.source_kind ORDER BY visits DESC, v.source ASC LIMIT 20
        `, filters.from ? [sqlDate(filters.from)] : []),
        pool.execute(`
          SELECT v.device, COUNT(*) AS visits
          ${baseFrom} ${where.sql}
          GROUP BY v.device ORDER BY visits DESC LIMIT 6
        `, where.params),
        pool.execute(`
          SELECT v.browser, COUNT(*) AS visits
          ${baseFrom} ${where.sql}
          GROUP BY v.browser ORDER BY visits DESC LIMIT 8
        `, where.params),
        pool.execute(`
          SELECT COALESCE(NULLIF(v.role, ''), 'guest') AS role, COUNT(*) AS visits
          ${baseFrom} ${where.sql}
          GROUP BY role ORDER BY visits DESC
        `, where.params),
        pool.execute(`
          SELECT p.path, SUM(p.views) AS views, COUNT(DISTINCT p.visit_id) AS visits,
            MAX(p.last_seen_at) AS last_seen_at
          FROM site_visit_pages p
          JOIN site_visits v ON v.id = p.visit_id
          LEFT JOIN users u ON LOWER(u.login) = v.login
          ${where.sql}
          GROUP BY p.path ORDER BY views DESC, p.path ASC LIMIT 10
        `, where.params)
      ]);

      const [[countRows], [rowResults]] = await Promise.all([
        pool.execute(`SELECT COUNT(*) AS total ${baseFrom} ${where.sql}`, where.params),
        pool.execute(`
          SELECT v.id, v.session_id, v.login, v.role, v.ip, v.user_agent, v.os, v.browser, v.device,
            v.source, v.source_kind, v.referrer, v.utm_source, v.utm_medium, v.utm_campaign,
            v.landing_path, v.last_path, v.page_views, v.active_seconds, v.language, v.timezone,
            v.screen, v.started_at, v.last_seen_at, u.full_name
          ${baseFrom} ${where.sql}
          ORDER BY ${sortSql(filters.sort)}
          LIMIT ${filters.pageSize} OFFSET ${offset}
        `, where.params)
      ]);

      const summaryRow = summaryRows[0] || {};
      const summary = {
        visits: number(summaryRow.visits),
        uniqueVisitors: number(summaryRow.unique_visitors),
        identified: number(summaryRow.identified),
        anonymous: number(summaryRow.anonymous),
        online: number(summaryRow.online),
        external: number(summaryRow.external),
        pageViews: number(summaryRow.page_views),
        totalSeconds: number(summaryRow.total_seconds),
        avgSeconds: Math.round(number(summaryRow.avg_seconds))
      };
      const total = number(countRows[0]?.total);

      res.set('Cache-Control', 'no-store');
      res.json({
        now,
        generatedAt: new Date(now).toISOString(),
        period: filters.period,
        filters: {
          period: filters.period,
          source: filters.source,
          role: filters.role,
          search: filters.search,
          online: filters.online,
          sort: filters.sort,
          page: filters.page,
          pageSize: filters.pageSize
        },
        summary,
        daily: dailyRows.map((row) => ({ day: row.day, visits: number(row.visits), visitors: number(row.visitors) })),
        sources: sourceRows.map((row) => ({ source: row.source, kind: row.source_kind, visits: number(row.visits) })),
        availableSources: availableSourceRows.map((row) => ({ source: row.source, kind: row.source_kind, visits: number(row.visits) })),
        devices: deviceRows.map((row) => ({ device: row.device || 'desktop', visits: number(row.visits) })),
        browsers: browserRows.map((row) => ({ browser: row.browser || 'other', visits: number(row.visits) })),
        roles: roleRows.map((row) => ({ role: row.role || 'guest', visits: number(row.visits) })),
        pages: pageRows.map((row) => ({ path: row.path, views: number(row.views), visits: number(row.visits), lastSeenAt: row.last_seen_at })),
        total,
        page: filters.page,
        pageSize: filters.pageSize,
        totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
        hasMore: offset + rowResults.length < total,
        rows: rowResults
      });
    } catch (error) {
      console.error('Ошибка отчёта посещений:', error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Не удалось загрузить журнал посещений' });
    }
  });

  router.get('/:id(\\d+)', async (req, res) => {
    try {
      await ensureVisitsSchema();
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Некорректный номер посещения' });
      const [visits] = await pool.execute(`
        SELECT v.id, v.session_id, v.login, v.role, v.ip, v.user_agent, v.os, v.browser, v.device,
          v.source, v.source_kind, v.referrer, v.utm_source, v.utm_medium, v.utm_campaign,
          v.landing_path, v.last_path, v.page_views, v.active_seconds, v.language, v.timezone,
          v.screen, v.started_at, v.last_seen_at, u.full_name
        FROM site_visits v LEFT JOIN users u ON LOWER(u.login) = v.login
        WHERE v.id = ? LIMIT 1
      `, [id]);
      if (!visits.length) return res.status(404).json({ error: 'Посещение не найдено' });
      const [pages] = await pool.execute(`
        SELECT path, title, views, first_seen_at, last_seen_at
        FROM site_visit_pages WHERE visit_id = ?
        ORDER BY last_seen_at DESC, id DESC LIMIT 100
      `, [id]);
      res.set('Cache-Control', 'no-store');
      res.json({ visit: visits[0], pages });
    } catch (error) {
      console.error('Ошибка карточки посещения:', error.message);
      res.status(500).json({ error: 'Не удалось загрузить посещение' });
    }
  });

  router.get('/export', async (req, res) => {
    try {
      await ensureVisitsSchema();
      const now = Date.now();
      const filters = parseFilters({ ...req.query, page: '1', pageSize: '100' }, now);
      const where = buildWhere(filters);
      const baseFrom = 'FROM site_visits v LEFT JOIN users u ON LOWER(u.login) = v.login';
      const [countRows] = await pool.execute(`SELECT COUNT(*) AS total ${baseFrom} ${where.sql}`, where.params);
      const total = number(countRows[0]?.total);
      if (total > MAX_EXPORT_ROWS) {
        return res.status(413).json({ error: `Экспорт ограничен ${MAX_EXPORT_ROWS} посещениями. Выберите меньший период.` });
      }
      const [rows] = await pool.execute(`
        SELECT v.id, v.login, v.role, v.ip, v.user_agent, v.os, v.browser, v.device,
          v.source, v.source_kind, v.referrer, v.utm_source, v.utm_medium, v.utm_campaign,
          v.landing_path, v.last_path, v.page_views, v.active_seconds, v.language, v.timezone,
          v.screen, v.started_at, v.last_seen_at, u.full_name
        ${baseFrom} ${where.sql}
        ORDER BY ${sortSql(filters.sort)}
        LIMIT ${MAX_EXPORT_ROWS}
      `, where.params);

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Посещения');
      sheet.columns = [
        ['ID', 'id', 8],
        ['Начало', 'started', 21],
        ['Последняя активность', 'lastSeen', 21],
        ['Сотрудник', 'name', 28],
        ['Логин', 'login', 18],
        ['Роль', 'role', 16],
        ['Источник', 'source', 20],
        ['Тип источника', 'sourceKind', 16],
        ['Переход с', 'referrer', 30],
        ['IP-адрес', 'ip', 18],
        ['Операционная система', 'os', 18],
        ['Браузер', 'browser', 18],
        ['Устройство', 'device', 14],
        ['Страниц', 'pages', 10],
        ['Время на сайте', 'duration', 18],
        ['Стартовая страница', 'landing', 34],
        ['Последняя страница', 'lastPath', 34],
        ['UTM-метки', 'utm', 24],
        ['Язык', 'language', 10],
        ['Экран', 'screen', 12],
        ['User-Agent', 'userAgent', 60]
      ].map(([header, key, width]) => ({ header, key, width }));
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = { from: 'A1', to: 'U1' };
      for (const row of rows) {
        sheet.addRow({
          id: row.id,
          started: formatDateRu(row.started_at),
          lastSeen: formatDateRu(row.last_seen_at),
          name: row.full_name || '',
          login: row.login || '',
          role: roleLabel(row.role),
          source: sourceLabel(row.source),
          sourceKind: row.source_kind || '',
          referrer: row.referrer || '',
          ip: row.ip || '',
          os: labelOf(OS_LABELS, row.os, 'Другое'),
          browser: labelOf(BROWSER_LABELS, row.browser, 'Другой'),
          device: labelOf(DEVICE_LABELS, row.device, 'Компьютер'),
          pages: number(row.page_views),
          duration: formatDurationRu(row.active_seconds),
          landing: row.landing_path || '',
          lastPath: row.last_path || '',
          utm: [row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean).join(' / '),
          language: row.language || '',
          screen: row.screen || '',
          userAgent: row.user_agent || ''
        });
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const fileName = `visits-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Novosibirsk' })}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Ошибка экспорта посещений:', error.message);
      if (!res.headersSent) res.status(error.status || 500).json({ error: error.status ? error.message : 'Не удалось сформировать файл Excel' });
      else res.destroy();
      return undefined;
    }
  });

  return router;
};

module.exports = { createVisitsRouter };

