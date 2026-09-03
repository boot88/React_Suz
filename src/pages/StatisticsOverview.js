import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './StatisticsOverview.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

const done = (app) => app.fl || app.status === 'done';
const dateOf = (app) => new Date(app.data || app.created_at || 0);
const seconds = (from, to) => {
  const start = new Date(from || 0).getTime(); const end = new Date(to || 0).getTime();
  return start && end && end >= start ? Math.round((end - start) / 1000) : null;
};
const minutes = (value) => value == null ? '—' : value < 60 ? `${Math.round(value)} мин` : `${Math.floor(value / 60)} ч ${Math.round(value % 60)} мин`;
const isOverdue = (app) => {
  if (done(app)) return false;
  const status = app.status || 'new';
  const start = ['new', 'reopened'].includes(status) ? (app.data || app.created_at) : (app.work_started_at || app.accepted_at || app.start_data);
  const limit = ['new', 'reopened'].includes(status) ? 15 : 30;
  return start && (Date.now() - new Date(start).getTime()) / 60000 > limit;
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
      .then(async (response) => { if (!response.ok) throw new Error('Не удалось загрузить данные'); return response.json(); })
      .then((data) => active && setApplications(data.applications || []))
      .catch((err) => active && setError(err.message || 'Не удалось загрузить данные'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const executors = useMemo(() => [...new Set(applications.map((app) => app.executor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [applications]);
  const categories = useMemo(() => [...new Set(applications.map((app) => app.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [applications]);
  const filtered = useMemo(() => {
    const threshold = period === 'all' ? null : Date.now() - Number(period) * 86400000;
    return applications.filter((app) => (!threshold || dateOf(app).getTime() >= threshold) && (executor === 'all' || app.executor === executor) && (category === 'all' || app.category === category));
  }, [applications, period, executor, category]);

  const metrics = useMemo(() => {
    const wait = filtered.map((app) => seconds(app.data || app.created_at, app.accepted_at || app.work_started_at)).filter((value) => value != null).map((value) => value / 60);
    const work = filtered.filter(done).map((app) => seconds(app.work_started_at || app.accepted_at || app.start_data, app.resolved_at || app.end_data || app.employee_confirmed_at)).filter((value) => value != null).map((value) => value / 60);
    const overdue = filtered.filter(isOverdue).length;
    return { total: filtered.length, wait: wait.length ? wait.reduce((sum, value) => sum + value, 0) / wait.length : null, work: work.length ? work.reduce((sum, value) => sum + value, 0) / work.length : null, overdue: filtered.length ? overdue / filtered.length * 100 : 0 };
  }, [filtered]);

  const dynamics = useMemo(() => {
    const map = new Map();
    filtered.forEach((app) => { const key = dateOf(app).toISOString().slice(0, 10); map.set(key, (map.get(key) || 0) + 1); });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date: new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }), value }));
  }, [filtered]);
  const workload = useMemo(() => {
    const map = new Map(); filtered.forEach((app) => { const key = app.executor || 'Не назначен'; map.set(key, (map.get(key) || 0) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  }, [filtered]);
  const sla = useMemo(() => {
    const overdue = filtered.filter(isOverdue).length; const onTime = Math.max(0, filtered.length - overdue);
    return [{ name: 'В срок', value: onTime }, { name: 'Просрочены', value: overdue }].filter((item) => item.value > 0);
  }, [filtered]);

  return <main className="statistics-overview">
    <header className="statistics-head"><div><h1>Статистика</h1><p>Динамика, нагрузка и соблюдение сроков</p></div></header>
    <section className="statistics-filters" aria-label="Фильтры статистики">
      <label>Период<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">Последние 7 дней</option><option value="30">Последние 30 дней</option><option value="90">Последние 90 дней</option><option value="all">Всё время</option></select></label>
      <label>Исполнитель<select value={executor} onChange={(event) => setExecutor(event.target.value)}><option value="all">Все исполнители</option>{executors.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Категория<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Все категории</option>{categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    </section>
    {loading && <div className="statistics-state">Загрузка статистики…</div>}
    {error && <div className="statistics-state statistics-state--error">{error}</div>}
    {!loading && !error && <>
      <section className="metrics-grid">
        <article><span>Заявок в выборке</span><strong>{metrics.total}</strong></article>
        <article><span>Среднее до назначения</span><strong>{minutes(metrics.wait)}</strong></article>
        <article><span>Среднее время работы</span><strong>{minutes(metrics.work)}</strong></article>
        <article className={metrics.overdue > 0 ? 'metric-danger' : ''}><span>Просрочено по SLA</span><strong>{metrics.overdue.toFixed(1)}%</strong></article>
      </section>
      <section className="reports-grid">
        <article className="report-card report-card--wide"><h2>Динамика заявок</h2><p>Количество обращений по дням</p><div className="chart-box"><ResponsiveContainer><LineChart data={dynamics}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={28} /><YAxis allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="value" name="Заявки" stroke="#2563eb" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div></article>
        <article className="report-card"><h2>Нагрузка по исполнителям</h2><p>Количество заявок в выбранном периоде</p><div className="chart-box"><ResponsiveContainer><BarChart data={workload} layout="vertical" margin={{ left: 22 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={105} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" name="Заявки" fill="#0f766e" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></article>
        <article className="report-card"><h2>Соблюдение сроков</h2><p>Открытые заявки с учётом SLA</p><div className="chart-box"><ResponsiveContainer><PieChart><Pie data={sla} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="78%" paddingAngle={3}>{sla.map((item, index) => <Cell key={item.name} fill={index === 0 ? '#16a34a' : '#dc2626'} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div></article>
      </section>
    </>}
  </main>;
}
