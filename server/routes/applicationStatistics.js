const express = require('express');
const PEOPLE = [
  { name: 'Повисок Е.В.', surname: 'повисок', initials: ['п', 'е'] },
  { name: 'Андреев Р.В.', surname: 'андреев', initials: ['а', 'р'] },
  { name: 'Польников Д.В.', surname: 'польников', initials: ['п', 'д'] }
];
const peopleOf = (value = '') => PEOPLE.filter(({ surname, initials: [a, b] }) =>
  String(value).toLowerCase().includes(surname) || new RegExp(`(?:^|[^а-яёa-z0-9])${a}\\s*\\.?\\s*${b}\\s*\\.?(?=$|[^а-яёa-z0-9])`, 'iu').test(value)
).map(({ name }) => name);
const matches = (executor, selected) => {
  const people = peopleOf(executor);
  return !selected.length || (people.length === selected.length && selected.every((name) => people.includes(name)));
};
const CREATED = 'COALESCE(created_at, CAST(data AS DATETIME))';
const CLOSED = "CASE WHEN fl = 1 OR status = 'done' THEN COALESCE(employee_confirmed_at, end_data, resolved_at) ELSE NULL END";
const BASE = `SELECT executor, COALESCE(status, 'new') AS status, COALESCE(fl, 0) AS fl, ${CREATED} AS created, ${CLOSED} AS closed FROM application WHERE deleted_at IS NULL`;
const sqlDate = (ms) => new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
const options = (query) => {
  const days = query.days === 'all' ? null : Number(query.days || 90);
  if (days !== null && (!Number.isInteger(days) || days < 7 || days > 36500)) throw new Error('Invalid period');
  const selected = query.executors ? JSON.parse(query.executors) : [];
  if (!Array.isArray(selected) || selected.length > 3 || selected.some((name) => !PEOPLE.some((person) => person.name === name))) throw new Error('Invalid executors');
  return { days, selected };
};
function createStatisticsRouter(pool) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    let config;
    try { config = options(req.query); } catch { return res.status(400).json({ error: 'Некорректные параметры статистики' }); }
    const { days, selected } = config;
    const now = Date.now(), end = now + 1, start = days ? end - days * 86400000 : null;
    try {
      const [meta] = await pool.execute(`SELECT MIN(${CREATED}) AS earliest FROM application WHERE deleted_at IS NULL`);
      const [groups] = await pool.execute(`SELECT DATE_FORMAT(DATE_ADD(created, INTERVAL 7 HOUR), '%Y-%m-%d') AS day, executor, CASE WHEN fl = 1 OR status = 'done' THEN 'done' ELSE COALESCE(status, 'new') END AS status, COUNT(*) AS count FROM (${BASE}) records WHERE created < ? ${start ? 'AND created >= ?' : ''} GROUP BY day, executor, status`, start ? [sqlDate(end), sqlDate(start)] : [sqlDate(end)]);
      let comparison = null;
      if (days) {
        const previousStart = start - days * 86400000;
        const windows = [{ from: start, to: end }, { from: previousStart, to: start }];
        const summaries = [];
        let excluded = 0;
        for (const window of windows) {
          const [rows] = await pool.execute(`SELECT executor,
            SUM(created IS NULL OR (closed IS NULL AND (fl = 1 OR status = 'done')) OR closed < created) AS excluded,
            SUM(CASE WHEN created IS NOT NULL AND (NOT (fl = 1 OR status = 'done') OR (closed IS NOT NULL AND closed >= created)) THEN created >= ? AND created < ? ELSE 0 END) AS received,
            SUM(CASE WHEN created IS NOT NULL AND closed >= created THEN closed >= ? AND closed < ? ELSE 0 END) AS closed,
            SUM(CASE WHEN created IS NOT NULL AND (NOT (fl = 1 OR status = 'done') OR (closed IS NOT NULL AND closed >= created)) THEN created < ? AND (closed IS NULL OR closed >= ?) ELSE 0 END) AS opening,
            SUM(CASE WHEN created IS NOT NULL AND (NOT (fl = 1 OR status = 'done') OR (closed IS NOT NULL AND closed >= created)) THEN created < ? AND (closed IS NULL OR closed >= ?) ELSE 0 END) AS remaining
            FROM (${BASE}) records GROUP BY executor`, [window.from, window.to, window.from, window.to, window.from, window.from, window.to, window.to].map(sqlDate));
          const summary = { ...window, received: 0, closed: 0, opening: 0, remaining: 0 };
          for (const row of rows.filter((row) => matches(row.executor, selected))) {
            for (const key of ['received', 'closed', 'opening', 'remaining']) summary[key] += Number(row[key] || 0);
          }
          if (!summaries.length) excluded = rows.filter((row) => matches(row.executor, selected)).reduce((sum, row) => sum + Number(row.excluded || 0), 0);
          summary.change = summary.remaining - summary.opening;
          summaries.push(summary);
        }
        comparison = { current: summaries[0], previous: summaries[1], excluded };
      }
      res.json({ now, earliest: meta[0]?.earliest || null, groups, comparison });
    } catch (error) { console.error('Statistics error:', error); res.status(500).json({ error: 'Не удалось загрузить данные' }); }
  });
  router.get('/day', async (req, res) => {
    let config;
    try { config = options(req.query); } catch { return res.status(400).json({ error: 'Некорректные параметры статистики' }); }
    const day = String(req.query.day || '');
    const date = new Date(`${day}T00:00:00+07:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== day) return res.status(400).json({ error: 'Некорректная дата' });
    const now = Number(req.query.now || Date.now());
    if (!Number.isFinite(now) || now <= 0 || now > Date.now() + 60000) return res.status(400).json({ error: 'Некорректная дата' });
    const from = Math.max(date.getTime(), config.days ? now + 1 - config.days * 86400000 : date.getTime());
    const to = Math.min(date.getTime() + 86400000, now + 1);
    if (from >= to) return res.json({ applications: [], hasMore: false });
    const offset = Math.min(1000000, Math.max(0, parseInt(req.query.offset) || 0));
    try {
      // Executor strings are obtained by a small grouped query; detail reads stay paginated.
      const [executors] = await pool.execute(`SELECT DISTINCT executor FROM application WHERE deleted_at IS NULL AND ${CREATED} >= ? AND ${CREATED} < ?`, [sqlDate(from), sqlDate(to)]);
      const selected = executors.filter((row) => matches(row.executor, config.selected));
      if (!selected.length) return res.json({ applications: [], hasMore: false });
      const clause = selected.map(() => 'executor <=> ?').join(' OR ');
      const params = [sqlDate(from), sqlDate(to), ...selected.map((row) => row.executor)];
      const [rows] = await pool.execute(`SELECT id, application, name FROM application WHERE deleted_at IS NULL AND ${CREATED} >= ? AND ${CREATED} < ? AND (${clause}) ORDER BY ${CREATED}, id LIMIT 101 OFFSET ${offset}`, params);
      res.json({ applications: rows.slice(0, 100), hasMore: rows.length > 100 });
    } catch (error) { console.error('Statistics day error:', error); res.status(500).json({ error: 'Не удалось загрузить данные' }); }
  });
  return router;
}
module.exports = { createStatisticsRouter, peopleOf, matches, options };
