import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import './StatisticsOverview.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import {
  APPLICATION_TIME_ZONE,
  formatApplicationDuration,
  toApplicationTimestamp
} from '../utils/applicationTime';

const EXECUTOR_CATEGORIES = [
  { name: 'Повисок Е.В.', shortName: 'П.Е.', group: 'Один исполнитель' },
  { name: 'Андреев Р.В.', shortName: 'А.Р.', group: 'Один исполнитель' },
  { name: 'Польников Д.В.', shortName: 'П.Д.', group: 'Один исполнитель' },
  { name: 'Повисок Е.В. Польников Д.В.', shortName: 'П.Е. + П.Д.', group: 'Пара' },
  { name: 'Повисок Е.В. Андреев Р.В.', shortName: 'П.Е. + А.Р.', group: 'Пара' },
  { name: 'Польников Д.В. Андреев Р.В.', shortName: 'П.Д. + А.Р.', group: 'Пара' },
  { name: 'Повисок Е.В. Польников Д.В. Андреев Р.В.', shortName: 'П.Е. + П.Д. + А.Р.', group: 'Тройка' }
];

const STATUS_GROUPS = [
  { key: 'queue', name: 'Новые и повторные', color: '#4f86a7' },
  { key: 'work', name: 'В работе', color: '#ad6b36' },
  { key: 'done', name: 'Выполненные', color: '#3f7b68' }
];

const getStatus = (app = {}) => app.fl || app.status === 'done' ? 'done' : (app.status || 'new');
const getStatusGroup = (app = {}) => {
  const status = getStatus(app);
  if (status === 'done') return 'done';
  if (['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(status)) return 'work';
  return 'queue';
};

const hasInitials = (value, surnameInitial, nameInitial) => {
  const pattern = new RegExp(`(?:^|[^а-яёa-z0-9])${surnameInitial}\\s*\\.?\\s*${nameInitial}\\s*\\.?(?=$|[^а-яёa-z0-9])`, 'iu');
  return pattern.test(value);
};

const executorCategoryOf = (value = '') => {
  const executor = String(value).toLocaleLowerCase('ru-RU');
  const selected = [
    (executor.includes('повисок') || hasInitials(executor, 'п', 'е')) && 'Повисок Е.В.',
    (executor.includes('андреев') || hasInitials(executor, 'а', 'р')) && 'Андреев Р.В.',
    (executor.includes('польников') || hasInitials(executor, 'п', 'д')) && 'Польников Д.В.'
  ].filter(Boolean);

  if (selected.length === 0) return null;
  return EXECUTOR_CATEGORIES.find(({ name }) => {
    const peopleInCategory = ['Повисок Е.В.', 'Андреев Р.В.', 'Польников Д.В.'].filter((person) => name.includes(person));
    return peopleInCategory.length === selected.length && selected.every((person) => peopleInCategory.includes(person));
  })?.name || null;
};

const average = (values) => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : null;

const durationBetween = (from, to) => {
  const start = toApplicationTimestamp(from);
  const end = toApplicationTimestamp(to);
  return start && end && end >= start ? Math.floor((end - start) / 1000) : null;
};

const formatDuration = (seconds) => seconds == null ? '—' : formatApplicationDuration(seconds);
const getClosedAt = (app = {}) => app.employee_confirmed_at || app.end_data || app.resolved_at;

const getDayKey = (app = {}) => {
  const timestamp = toApplicationTimestamp(app.created_at || app.data);
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString('sv-SE', { timeZone: APPLICATION_TIME_ZONE });
};

const formatDay = (dayKey) => {
  const date = new Date(`${dayKey}T12:00:00Z`);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: APPLICATION_TIME_ZONE });
};

export default function StatisticsOverview() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('30');
  const [executor, setExecutor] = useState('all');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    let active = true;
    authFetch(`${API_BASE_URL}/applications?limit=1000&sort=date_desc`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось загрузить данные');
        return response.json();
      })
      .then((data) => active && setApplications(data.applications || []))
      .catch((err) => active && setError(err.message || 'Не удалось загрузить данные'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const categories = useMemo(() => (
    [...new Set(applications.map((app) => app.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'))
  ), [applications]);

  const periodAndCategoryFiltered = useMemo(() => {
    const threshold = period === 'all' ? null : Date.now() - Number(period) * 86400000;
    return applications.filter((app) => {
      const createdAt = toApplicationTimestamp(app.created_at || app.data);
      const inPeriod = !threshold || (createdAt && createdAt >= threshold);
      return inPeriod && (category === 'all' || app.category === category);
    });
  }, [applications, period, category]);

  const filtered = useMemo(() => (
    periodAndCategoryFiltered.filter((app) => executor === 'all' || executorCategoryOf(app.executor) === executor)
  ), [periodAndCategoryFiltered, executor]);

  const metrics = useMemo(() => {
    const statusCounts = { queue: 0, work: 0, done: 0 };
    filtered.forEach((app) => { statusCounts[getStatusGroup(app)] += 1; });
    return { total: filtered.length, ...statusCounts };
  }, [filtered]);

  const dynamics = useMemo(() => {
    const countsByDay = new Map();
    filtered.forEach((app) => {
      const day = getDayKey(app);
      if (day) countsByDay.set(day, (countsByDay.get(day) || 0) + 1);
    });
    return [...countsByDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, value]) => ({ day, date: formatDay(day), value }));
  }, [filtered]);

  const statusData = useMemo(() => STATUS_GROUPS
    .map((status) => ({ ...status, value: metrics[status.key] }))
    .filter(({ value }) => value > 0), [metrics]);

  const executorRows = useMemo(() => {
    const visibleCategories = executor === 'all'
      ? EXECUTOR_CATEGORIES
      : EXECUTOR_CATEGORIES.filter(({ name }) => name === executor);

    return visibleCategories.map((executorCategory) => {
      const matching = periodAndCategoryFiltered.filter((app) => executorCategoryOf(app.executor) === executorCategory.name);
      const counts = { queue: 0, work: 0, done: 0 };
      matching.forEach((app) => { counts[getStatusGroup(app)] += 1; });
      const closingTimes = matching
        .filter((app) => getStatus(app) === 'done')
        .map((app) => durationBetween(app.created_at || app.data, getClosedAt(app)))
        .filter((value) => value != null);
      return {
        ...executorCategory,
        ...counts,
        total: matching.length,
        averageClosingSeconds: average(closingTimes)
      };
    });
  }, [periodAndCategoryFiltered, executor]);

  const workload = useMemo(() => executorRows.map((row) => ({
    name: row.shortName,
    fullName: row.name,
    value: row.total
  })), [executorRows]);

  const hasFilters = period !== '30' || executor !== 'all' || category !== 'all';
  const resetFilters = () => {
    setPeriod('30');
    setExecutor('all');
    setCategory('all');
  };

  return <main className="statistics-overview">
    <header className="statistics-head">
      <div>
        <span className="statistics-kicker">Аналитика заявок</span>
        <h1>Статистика</h1>
        <p>Объём обращений, текущие состояния и нагрузка исполнителей</p>
      </div>
    </header>

    <section className="statistics-filters" aria-label="Фильтры статистики">
      <label>Период<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">Последние 7 дней</option><option value="30">Последние 30 дней</option><option value="90">Последние 90 дней</option><option value="all">Всё время</option></select></label>
      <label>Исполнитель<select value={executor} onChange={(event) => setExecutor(event.target.value)}><option value="all">Все исполнители</option>{EXECUTOR_CATEGORIES.map(({ name }) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>Категория<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Все категории</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      {hasFilters && <button type="button" className="statistics-reset" onClick={resetFilters}>Сбросить</button>}
    </section>

    {loading && <div className="statistics-state">Загрузка статистики…</div>}
    {error && <div className="statistics-state statistics-state--error">{error}</div>}
    {!loading && !error && <>
      <section className="metrics-grid" aria-label="Основные показатели">
        <article className="metric-total"><span>Всего заявок</span><strong>{metrics.total}</strong><small>в выбранном периоде</small></article>
        <article className="metric-queue"><span>Новые и повторные</span><strong>{metrics.queue}</strong><small>ожидают начала работы</small></article>
        <article className="metric-work"><span>В работе</span><strong>{metrics.work}</strong><small>включая ожидание подтверждения</small></article>
        <article className="metric-done"><span>Выполненные</span><strong>{metrics.done}</strong><small>{metrics.total ? <>{Math.round(metrics.done / metrics.total * 100)}% <span className="metric-note-inline">от выборки</span></> : 'нет заявок в выборке'}</small></article>
      </section>

      <section className="reports-grid">
        <article className="report-card report-card--wide">
          <div className="report-card-head"><div><h2>Динамика заявок</h2><p>Количество обращений по дням</p></div></div>
          {dynamics.length > 0 ? <div className="chart-box chart-box--trend"><ResponsiveContainer><LineChart data={dynamics} margin={{ top: 8, right: 14, left: -12, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" minTickGap={28} /><YAxis allowDecimals={false} /><Tooltip formatter={(value) => [value, 'Заявки']} /><Line type="monotone" dataKey="value" name="Заявки" stroke="#4f86a7" strokeWidth={3} dot={{ r: 3, fill: '#4f86a7' }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <div className="chart-empty">За выбранный период заявок нет</div>}
        </article>

        <article className="report-card">
          <div className="report-card-head"><div><h2>Нагрузка по исполнителям</h2><p>Одиночные, затем пары и тройка</p></div></div>
          <div className="chart-box chart-box--workload"><ResponsiveContainer><BarChart data={workload} layout="vertical" margin={{ top: 4, right: 20, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={106} tick={{ fontSize: 12 }} /><Tooltip formatter={(value) => [value, 'Заявки']} labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label} /><Bar dataKey="value" name="Заявки" fill="#4f86a7" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div>
        </article>

        <article className="report-card">
          <div className="report-card-head"><div><h2>Статусы заявок</h2><p>Текущее распределение выбранной выборки</p></div></div>
          {statusData.length > 0 ? <div className="chart-box"><ResponsiveContainer><PieChart><Pie data={statusData} dataKey="value" nameKey="name" innerRadius="53%" outerRadius="76%" paddingAngle={3}>{statusData.map((item) => <Cell key={item.key} fill={item.color} />)}</Pie><Tooltip formatter={(value) => [value, 'Заявки']} /><Legend /></PieChart></ResponsiveContainer></div> : <div className="chart-empty">Нет данных для распределения</div>}
        </article>

        <article className="report-card report-card--wide executor-summary-card">
          <div className="report-card-head">
            <div><h2>Сводка по исполнителям</h2><p>В статистике учитываются только Повисок Е.В., Андреев Р.В., Польников Д.В. и их сочетания</p></div>
          </div>
          <div className="statistics-table-wrap">
            <table className="statistics-table">
              <thead><tr><th>Тип</th><th>Исполнитель</th><th>Всего</th><th>Новые</th><th>В работе</th><th>Выполнено</th><th>Среднее до закрытия</th></tr></thead>
              <tbody>{executorRows.map((row) => <tr key={row.name}><td><span className={`executor-group executor-group--${row.group === 'Пара' ? 'pair' : row.group === 'Тройка' ? 'triple' : 'single'}`}>{row.group}</span></td><td><strong>{row.name}</strong><small>{row.shortName}</small></td><td>{row.total}</td><td>{row.queue}</td><td>{row.work}</td><td>{row.done}</td><td>{formatDuration(row.averageClosingSeconds)}</td></tr>)}</tbody>
            </table>
          </div>
        </article>
      </section>
    </>}
  </main>;
}
