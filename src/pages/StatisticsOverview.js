import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const getDayKey = (app = {}) => {
  const timestamp = toApplicationTimestamp(app.created_at || app.data);
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString('sv-SE', { timeZone: APPLICATION_TIME_ZONE });
};

const formatDay = (dayKey) => {
  const date = new Date(`${dayKey}T12:00:00Z`);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: APPLICATION_TIME_ZONE });
};

const shiftDayKey = (dayKey, days) => {
  const date = new Date(`${dayKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getApplicationTitle = (app = {}) => app.application || app.name || 'Без названия заявки';

const RANGE_PRESETS = [
  { days: 1, label: '1 день' },
  { days: 7, label: '7 дней' },
  { days: 30, label: '1 месяц' },
  { days: 90, label: '3 месяца' },
  { days: 180, label: '6 месяцев' }
];

const snapRangeDays = (days, availableDays) => {
  const safeDays = Math.max(1, Math.min(availableDays, Math.round(days)));
  const candidates = [...RANGE_PRESETS.map(({ days: value }) => value), availableDays]
    .filter((value) => value <= availableDays);
  const nearest = candidates.reduce((best, value) => (
    Math.abs(value - safeDays) < Math.abs(best - safeDays) ? value : best
  ), candidates[0] || safeDays);
  return Math.abs(nearest - safeDays) <= Math.max(2, nearest * .1) ? nearest : safeDays;
};

function ApplicationDayTooltip({ point, onOpenApplication, onMouseEnter, onMouseLeave, style }) {
  if (!point) return null;
  return (
    <div
      className="statistics-day-tooltip statistics-floating-tooltip"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <strong>{point.date}</strong>
      <span>{point.value} {point.value === 1 ? 'заявка' : 'заявок'}</span>
      <div>
        {point.applications.map((app) => (
          <button key={app.id} type="button" onClick={() => onOpenApplication(app)}>
            <small>#{app.id}</small>{getApplicationTitle(app)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ApplicationPointDot({ cx, cy, payload, onShow, onScheduleHide }) {
  if (!payload?.value) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill="#4f86a7"
      stroke="#fffdf8"
      strokeWidth={2}
      className="statistics-application-point"
      onMouseEnter={() => onShow(payload, cx, cy)}
      onMouseLeave={onScheduleHide}
    />
  );
}

export default function StatisticsOverview() {
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('30');
  const [executor, setExecutor] = useState('all');
  const [category, setCategory] = useState('all');
  const [activeDay, setActiveDay] = useState('');
  const [isDraggingChart, setIsDraggingChart] = useState(false);
  const [chartDragDirection, setChartDragDirection] = useState('');
  const [floatingDay, setFloatingDay] = useState(null);
  const chartDragRef = useRef(null);
  const chartAreaRef = useRef(null);
  const tooltipCloseTimerRef = useRef(null);

  useEffect(() => {
    let active = true;
    const loadAllApplications = async () => {
      const allApplications = [];
      let page = 1;
      let totalPages = 1;
      do {
        const response = await authFetch(`${API_BASE_URL}/applications?page=${page}&limit=1000&sort=date_desc`);
        if (!response.ok) throw new Error('Не удалось загрузить данные');
        const data = await response.json();
        allApplications.push(...(data.applications || []));
        totalPages = Math.max(1, Number(data.totalPages) || 1);
        page += 1;
      } while (active && page <= totalPages);
      if (active) setApplications(allApplications);
    };

    loadAllApplications()
      .catch((err) => active && setError(err.message || 'Не удалось загрузить данные'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const categories = useMemo(() => (
    [...new Set(applications.map((app) => app.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'))
  ), [applications]);

  const availableRangeDays = useMemo(() => {
    const timestamps = applications
      .map((app) => toApplicationTimestamp(app.created_at || app.data))
      .filter(Boolean);
    if (timestamps.length === 0) return 1;
    const earliest = Math.min(...timestamps);
    return Math.max(1, Math.ceil((Date.now() - earliest) / 86400000) + 1);
  }, [applications]);

  const availableStartLabel = useMemo(() => {
    const timestamps = applications
      .map((app) => toApplicationTimestamp(app.created_at || app.data))
      .filter(Boolean);
    if (timestamps.length === 0) return '';
    return new Date(Math.min(...timestamps)).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: APPLICATION_TIME_ZONE
    });
  }, [applications]);

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
    const applicationsByDay = new Map();
    filtered.forEach((app) => {
      const day = getDayKey(app);
      if (!day) return;
      const dayApplications = applicationsByDay.get(day) || [];
      dayApplications.push(app);
      applicationsByDay.set(day, dayApplications);
    });
    if (applicationsByDay.size === 0) return [];

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: APPLICATION_TIME_ZONE });
    const visibleDays = period === 'all' ? availableRangeDays : Math.min(availableRangeDays, Number(period) || 30);
    const globalDays = applications.map(getDayKey).filter(Boolean).sort();
    const startDay = period === 'all'
      ? globalDays[0]
      : shiftDayKey(today, -(visibleDays - 1));
    const points = [];
    for (let day = startDay; day <= today; day = shiftDayKey(day, 1)) {
      const dayApplications = applicationsByDay.get(day) || [];
      points.push({
        day,
        date: formatDay(day),
        value: dayApplications.length,
        applications: dayApplications.sort((left, right) => (
          toApplicationTimestamp(left.created_at || left.data) - toApplicationTimestamp(right.created_at || right.data)
        ))
      });
    }
    return points;
  }, [applications, availableRangeDays, filtered, period]);

  useEffect(() => {
    if (dynamics.length === 0) {
      setActiveDay('');
      return;
    }
    if (!dynamics.some((point) => point.day === activeDay)) {
      const latestWithApplications = [...dynamics].reverse().find((point) => point.value > 0);
      setActiveDay((latestWithApplications || dynamics[dynamics.length - 1]).day);
    }
  }, [activeDay, dynamics]);

  useEffect(() => () => window.clearTimeout(tooltipCloseTimerRef.current), []);

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
      return {
        ...executorCategory,
        ...counts,
        total: matching.length
      };
    });
  }, [periodAndCategoryFiltered, executor]);

  const workload = useMemo(() => executorRows.map((row) => ({
    name: row.shortName,
    fullName: row.name,
    value: row.total
  })), [executorRows]);

  const activeDayData = useMemo(() => (
    dynamics.find((point) => point.day === activeDay) || null
  ), [activeDay, dynamics]);

  const currentRangeDays = period === 'all' ? availableRangeDays : Math.min(availableRangeDays, Number(period) || 30);
  const customPeriod = period !== 'all' && !RANGE_PRESETS.some(({ days }) => String(days) === period);
  const rangeLabel = period === 'all'
    ? `Всё время${availableStartLabel ? ` · с ${availableStartLabel}` : ''}`
    : `Последние ${currentRangeDays} дн.`;

  const setRangeDays = (days) => {
    const nextDays = snapRangeDays(days, availableRangeDays);
    setPeriod(nextDays >= availableRangeDays ? 'all' : String(nextDays));
  };

  const handleChartPointerDown = (event) => {
    if (event.target.closest('button, a')) return;
    chartDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      width: Math.max(1, event.currentTarget.getBoundingClientRect().width),
      startDays: currentRangeDays
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsDraggingChart(true);
    setChartDragDirection('');
  };

  const keepPointTooltipOpen = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
  };

  const showPointTooltip = (point, x, y) => {
    keepPointTooltipOpen();
    const bounds = chartAreaRef.current?.getBoundingClientRect();
    setActiveDay(point.day);
    setFloatingDay({
      point,
      x,
      y,
      alignRight: Boolean(bounds && x > bounds.width * .58),
      alignBottom: Boolean(bounds && y > bounds.height * .5)
    });
  };

  const schedulePointTooltipClose = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
    tooltipCloseTimerRef.current = window.setTimeout(() => setFloatingDay(null), 420);
  };

  const handleChartPointerMove = (event) => {
    const drag = chartDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) < 8) return;
    setChartDragDirection(delta < 0 ? 'out' : 'in');
  };

  const handleChartPointerEnd = (event) => {
    const drag = chartDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    const fraction = Math.min(1, Math.abs(delta) / drag.width);
    if (Math.abs(delta) >= 12) {
      const nextDays = delta < 0
        ? drag.startDays + (availableRangeDays - drag.startDays) * fraction
        : drag.startDays - (drag.startDays - 1) * fraction;
      setRangeDays(nextDays);
    }
    chartDragRef.current = null;
    setIsDraggingChart(false);
    setChartDragDirection('');
  };

  const openApplication = (app) => {
    if (!app?.id) return;
    navigate(`/?application=${encodeURIComponent(app.id)}`);
  };

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
      <label>Период<select value={period} onChange={(event) => setPeriod(event.target.value)}>{customPeriod && <option value={period}>Последние {period} дней</option>}<option value="1">Последний день</option><option value="7">Последние 7 дней</option><option value="30">Последние 30 дней</option><option value="90">Последние 3 месяца</option><option value="180">Последние 6 месяцев</option><option value="all">Всё время</option></select></label>
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
          <div className="report-card-head statistics-trend-head">
            <div><h2>Динамика заявок</h2><p>Наведите на точку, чтобы увидеть заявки. Нажмите название — откроется карточка.</p></div>
            <span className="statistics-range-label">{rangeLabel}</span>
          </div>
          <div className="statistics-range-controls" aria-label="Масштаб графика">
            {RANGE_PRESETS.map((preset) => <button key={preset.days} type="button" className={period === String(preset.days) ? 'active' : ''} disabled={preset.days > availableRangeDays} onClick={() => setRangeDays(preset.days)}>{preset.label}</button>)}
            <button type="button" className={period === 'all' ? 'active' : ''} onClick={() => setPeriod('all')}>Всё время</button>
          </div>
          <div className={`statistics-drag-hint ${isDraggingChart ? 'is-dragging' : ''}`}>
            <span aria-hidden="true">←</span>
            {isDraggingChart ? (chartDragDirection === 'out' ? 'Расширяем период' : chartDragDirection === 'in' ? 'Приближаем период' : 'Ведите влево или вправо') : 'Зажмите график и ведите влево — больше времени, вправо — подробнее'}
            <span aria-hidden="true">→</span>
          </div>
          {dynamics.length > 0 ? <>
            <div
              ref={chartAreaRef}
              className={`chart-box chart-box--trend chart-interaction-area ${isDraggingChart ? 'is-dragging' : ''}`}
              onPointerDown={handleChartPointerDown}
              onPointerMove={handleChartPointerMove}
              onPointerUp={handleChartPointerEnd}
              onPointerCancel={handleChartPointerEnd}
            >
              <ResponsiveContainer>
                <LineChart
                  data={dynamics}
                  margin={{ top: 12, right: 18, left: -12, bottom: 4 }}
                  onMouseMove={(state) => {
                    const point = state?.activePayload?.[0]?.payload;
                    if (point?.day) setActiveDay(point.day);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" minTickGap={28} />
                  <YAxis allowDecimals={false} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name="Заявки"
                    stroke="#4f86a7"
                    strokeWidth={3}
                    dot={<ApplicationPointDot onShow={showPointTooltip} onScheduleHide={schedulePointTooltipClose} />}
                    activeDot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              {floatingDay && <ApplicationDayTooltip
                point={floatingDay.point}
                onOpenApplication={openApplication}
                onMouseEnter={keepPointTooltipOpen}
                onMouseLeave={schedulePointTooltipClose}
                style={{
                  left: floatingDay.alignRight ? floatingDay.x - 12 : floatingDay.x + 12,
                  top: floatingDay.alignBottom ? 'auto' : floatingDay.y + 10,
                  right: 'auto',
                  bottom: floatingDay.alignBottom ? `calc(100% - ${floatingDay.y - 10}px)` : 'auto',
                  transform: floatingDay.alignRight ? 'translateX(-100%)' : 'none'
                }}
              />}
            </div>
            {activeDayData && <div className="statistics-day-applications">
              <div><strong>Заявки за {activeDayData.date}</strong><span>{activeDayData.value}</span></div>
              <div>{activeDayData.applications.map((app) => <button key={app.id} type="button" onClick={() => openApplication(app)}><small>#{app.id}</small><span>{getApplicationTitle(app)}</span></button>)}</div>
            </div>}
          </> : <div className="chart-empty">За выбранный период заявок нет</div>}
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
              <thead><tr><th>Тип</th><th>Исполнитель</th><th>Всего</th><th>Новые</th><th>В работе</th><th>Выполнено</th></tr></thead>
              <tbody>{executorRows.map((row) => <tr key={row.name}><td><span className={`executor-group executor-group--${row.group === 'Пара' ? 'pair' : row.group === 'Тройка' ? 'triple' : 'single'}`}>{row.group}</span></td><td><strong>{row.name}</strong><small>{row.shortName}</small></td><td>{row.total}</td><td>{row.queue}</td><td>{row.work}</td><td>{row.done}</td></tr>)}</tbody>
            </table>
          </div>
        </article>
      </section>
    </>}
  </main>;
}
