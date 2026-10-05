const CREATED_SQL = 'COALESCE(`created_at`, CAST(`data` AS DATETIME))';
const STATUSES = {
  done: ['done'], pending: ['new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened'],
  queue: ['new', 'reopened'], active: ['accepted', 'in_progress'],
  inwork: ['accepted', 'in_progress', 'waiting_employee_confirmation'], confirmation: ['waiting_employee_confirmation']
};
const sqlDate = (value) => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
const dayBoundary = (value, next = false) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw Object.assign(new Error('Неверный формат даты. Используйте YYYY-MM-DD'), { status: 400 });
  const date = new Date(`${value}T00:00:00+07:00`);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== value) throw Object.assign(new Error('Некорректная дата'), { status: 400 });
  return sqlDate(date.getTime() + (next ? 86400000 : 0));
};
const buildApplicationQuery = (query = {}, overdueSql) => {
  const clauses = ['`deleted_at` IS NULL'], params = [];
  const { status, from, to, search, employee_login, queue, assignee } = query;
  if (from && to && from > to) throw Object.assign(new Error('Начало периода должно быть раньше окончания'), { status: 400 });
  if (status && status !== 'all') {
    if (status === 'overdue') clauses.push(overdueSql);
    else {
      const statuses = STATUSES[status] || [status];
      const condition = '`status` IN (' + statuses.map(() => '?').join(',') + ')';
      clauses.push(status === 'done' ? `(${condition} OR COALESCE(\`fl\`, 0) = 1)` : `COALESCE(\`fl\`, 0) = 0 AND ${condition}`);
      params.push(...statuses);
    }
  }
  if (from) { clauses.push(`${CREATED_SQL} >= ?`); params.push(dayBoundary(from)); }
  if (to) { clauses.push(`${CREATED_SQL} < ?`); params.push(dayBoundary(to, true)); }
  if (typeof search === 'string' && search.trim()) {
    const fields = ['application', 'name', 'cabinet', 'N_tel', 'executor', 'category', 'priority'];
    clauses.push('(' + fields.map((field) => `\`${field}\` LIKE ?`).join(' OR ') + ')');
    params.push(...fields.map(() => `%${search.trim()}%`));
  }
  if (typeof employee_login === 'string' && employee_login.trim()) { clauses.push('LOWER(`employee_login`) = ?'); params.push(employee_login.trim().toLowerCase()); }
  if (queue === 'unassigned') clauses.push("COALESCE(`fl`, 0) = 0 AND COALESCE(NULLIF(TRIM(`executor`), ''), NULLIF(TRIM(`accepted_by`), '')) IS NULL");
  if (queue === 'my' && typeof assignee === 'string' && assignee.trim()) {
    clauses.push("(LOWER(COALESCE(`executor`, '')) LIKE ? OR LOWER(COALESCE(`accepted_by`, '')) = ?)");
    params.push(`%${assignee.trim().toLowerCase()}%`, assignee.trim().toLowerCase());
  }
  return { whereSql: 'WHERE ' + clauses.join(' AND '), params };
};
const orderApplications = (sort) => sort === 'date_asc'
  ? `ORDER BY ${CREATED_SQL} ASC, id ASC` : `ORDER BY ${CREATED_SQL} DESC, id DESC`;
const aggregateSql = (overdueSql) => `COUNT(*) AS total,
  SUM(fl = 1 OR status = 'done') AS completed,
  SUM(COALESCE(fl, 0) = 0 AND status IN ('new','accepted','in_progress','waiting_employee_confirmation','reopened')) AS pending,
  SUM(COALESCE(fl, 0) = 0 AND status IN ('new','reopened')) AS queue,
  SUM(COALESCE(fl, 0) = 0 AND status = 'accepted') AS accepted,
  SUM(COALESCE(fl, 0) = 0 AND status = 'in_progress') AS in_progress,
  SUM(COALESCE(fl, 0) = 0 AND status IN ('accepted','in_progress')) AS active,
  SUM(COALESCE(fl, 0) = 0 AND status IN ('accepted','in_progress','waiting_employee_confirmation')) AS inwork,
  SUM(COALESCE(fl, 0) = 0 AND status = 'waiting_employee_confirmation') AS confirmation,
  SUM(${overdueSql}) AS overdue`;
const numericStats = (row = {}) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value) || 0]));
module.exports = { CREATED_SQL, buildApplicationQuery, orderApplications, aggregateSql, numericStats, dayBoundary };
