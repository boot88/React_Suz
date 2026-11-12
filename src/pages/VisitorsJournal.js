import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import AdminNotice from '../components/AdminNotice';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { useAdminLanguage, useAdminTranslation, getAdminLocale } from '../utils/adminTranslation';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import {
  fillVisitDays,
  formatVisitDateTime,
  formatVisitDay,
  formatVisitDuration,
  formatVisitNumber,
  formatVisitTime,
  isVisitOnline,
  visitBrowserLabel,
  visitDeviceLabel,
  visitOsLabel,
  visitRoleLabel,
  visitSourceLabel
} from '../utils/visitorFormatting';
import './VisitorsJournal.css';

const PAGE_SIZE = 25;
const PERIOD_OPTIONS = [
  { value: '1', label: 'Сегодня' },
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '365', label: 'Год' },
  { value: 'all', label: 'Всё время' }
];
const ROLE_OPTIONS = [
  { value: '', label: 'Все роли' },
  { value: 'admin', label: 'Администраторы' },
  { value: 'manager', label: 'Менеджеры' },
  { value: 'employee', label: 'Сотрудники' },
  { value: 'guest', label: 'Гости' }
];
const SORT_OPTIONS = [
  { value: 'recent', label: 'Сначала новые' },
  { value: 'duration', label: 'Дольше на сайте' },
  { value: 'pages', label: 'Больше страниц' }
];
const CHART_COLORS = ['#4f86a7', '#7fa6bf', '#ad6b36', '#3f7b68', '#a64e4e', '#8a7fb0', '#c49a6c', '#5c8a8a'];
const ROLE_COLORS = { admin: '#2f6587', manager: '#ad6b36', employee: '#3f7b68', guest: '#8b8f91' };

const shorten = (value, max = 34) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const referrerHost = (value) => {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
};

const dayLabel = (day, locale) => {
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(locale, { day: '2-digit', month: 'short', timeZone: 'Asia/Novosibirsk' })
    : day;
};

export default function VisitorsJournal() {
  const { user } = useAuth();
  const adminLanguage = useAdminLanguage();
  const t = useAdminTranslation();
  const locale = getAdminLocale(adminLanguage);
  const isAdmin = user?.role === 'admin' || user?.serverRole === 'admin';

  const [period, setPeriod] = useState('7');
  const [source, setSource] = useState('');
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sourceOptions, setSourceOptions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [clock, setClock] = useState(Date.now());

  const dataRef = useRef(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersionRef.current;
    const params = new URLSearchParams({
      period,
      sort,
      page: String(page),
      pageSize: String(PAGE_SIZE)
    });
    if (source) params.set('source', source);
    if (role) params.set('role', role);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (onlineOnly) params.set('online', '1');

    if (dataRef.current) setRefreshing(true);
    else setLoading(true);
    setError('');

    authFetch(`${API_BASE_URL}/visits?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Не удалось загрузить журнал посещений');
        }
        return response.json();
      })
      .then((payload) => {
        if (version !== requestVersionRef.current) return;
        dataRef.current = payload;
        setData(payload);
        setClock(Date.now());
      })
      .catch((requestError) => {
        if (controller.signal.aborted || version !== requestVersionRef.current) return;
        setError(requestError.message || 'Не удалось загрузить журнал посещений');
      })
      .finally(() => {
        if (version !== requestVersionRef.current) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => controller.abort();
  }, [period, source, role, debouncedSearch, sort, page, onlineOnly, reloadToken]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setReloadToken((value) => value + 1);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data?.availableSources) return;
    setSourceOptions((current) => {
      const merged = new Map(current.map((item) => [item.source, item]));
      data.availableSources.forEach((item) => merged.set(item.source, item));
      return Array.from(merged.values()).sort((left, right) => (right.visits || 0) - (left.visits || 0));
    });
  }, [data]);

  useEffect(() => {
    if (data && data.rows.length === 0 && page > 1) setPage(Math.max(1, data.totalPages || 1));
  }, [data, page]);


  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
  };

  const openDetail = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/visits/${id}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Не удалось загрузить посещение');
      }
      setDetail(await response.json());
    } catch (detailRequestError) {
      setDetailError(detailRequestError.message || 'Не удалось загрузить посещение');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeDetail();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  const resetFilters = () => {
    setPeriod('7');
    setSource('');
    setRole('');
    setSearch('');
    setDebouncedSearch('');
    setSort('recent');
    setOnlineOnly(false);
    setPage(1);
  };

  const exportVisits = async () => {
    setExporting(true);
    setExportError('');
    try {
      const params = new URLSearchParams({ period, sort });
      if (source) params.set('source', source);
      if (role) params.set('role', role);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (onlineOnly) params.set('online', '1');
      const response = await authFetch(`${API_BASE_URL}/visits/export?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Не удалось сформировать файл Excel');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `visits-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportRequestError) {
      setExportError(exportRequestError.message || 'Не удалось сформировать файл Excel');
    } finally {
      setExporting(false);
    }
  };

  const dailyData = useMemo(() => {
    const days = period === 'all' ? null : Number(period);
    return fillVisitDays(data?.daily, Number.isFinite(days) ? days : null, data?.now || Date.now())
      .map((item) => ({ ...item, label: dayLabel(item.day, locale) }));
  }, [data, period, locale]);

  const sourceData = useMemo(() => (data?.sources || []).slice(0, 8).map((item) => ({
    ...item,
    name: t(visitSourceLabel(item.source))
  })), [data, t]);

  const deviceData = useMemo(() => (data?.devices || []).map((item) => ({
    ...item,
    name: t(visitDeviceLabel(item.device))
  })), [data, t]);

  const roleData = useMemo(() => (data?.roles || []).map((item) => ({
    ...item,
    name: t(visitRoleLabel(item.role))
  })), [data, t]);

  const topPages = useMemo(() => (data?.pages || []).slice(0, 8).map((item) => ({
    ...item,
    name: shorten(item.path, 32),
    fullName: item.path
  })), [data]);

  const summary = data?.summary || {
    visits: 0, uniqueVisitors: 0, online: 0, identified: 0, anonymous: 0,
    pageViews: 0, avgSeconds: 0, external: 0
  };

  const totalPages = Math.max(1, data?.totalPages || 1);
  const rangeStart = data?.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = data?.total ? Math.min(page * PAGE_SIZE, data.total) : 0;
  const statCards = [
    {
      key: 'visits',
      label: 'Визиты',
      value: formatVisitNumber(summary.visits, locale),
      note: `${formatVisitNumber(summary.identified, locale)} ${t('сотрудников')} · ${formatVisitNumber(summary.anonymous, locale)} ${t('гостей')}`,
      tone: 'accent'
    },
    {
      key: 'visitors',
      label: 'Уникальные посетители',
      value: formatVisitNumber(summary.uniqueVisitors, locale),
      note: t('По логину или IP-адресу'),
      tone: 'accent'
    },
    {
      key: 'online',
      label: 'Сейчас на сайте',
      value: formatVisitNumber(summary.online, locale),
      note: t('Активность за последние 2 минуты'),
      tone: 'success'
    },
    {
      key: 'average',
      label: 'Среднее время на сайте',
      value: formatVisitDuration(summary.avgSeconds, t),
      note: t('Активное время вкладки'),
      tone: 'warning'
    },
    {
      key: 'pages',
      label: 'Просмотры страниц',
      value: formatVisitNumber(summary.pageViews, locale),
      note: t('Переходы внутри системы'),
      tone: 'accent'
    },
    {
      key: 'external',
      label: 'Переходы с сайтов',
      value: formatVisitNumber(summary.external, locale),
      note: t('Поиск, соцсети и внешние ссылки'),
      tone: 'warning'
    }
  ];

  const selectedVisit = detail?.visit || null;
  const selectedPages = detail?.pages || [];

  return (
    <div className="visitors-journal">
      <header className="visitors-head">
        <div>
          <span className="visitors-kicker">{t('Диагностика')}</span>
          <h1>{t('Журнал посещений')}</h1>
          <p>{t('Кто, откуда и как долго открывал систему. Гости учитываются без входа.')}</p>
        </div>
        <div className="visitors-head-actions">
          {!isAdmin && <Link className="visitors-button visitors-back-link" to="/employee">{t('Назад')}</Link>}
          <span className={refreshing ? 'visitors-updated is-busy' : 'visitors-updated'}>
            {refreshing
              ? t('Обновление…')
              : data
                ? `${t('Обновлено')} ${formatVisitTime(data.now, locale)}`
                : t('Загрузка…')}
          </span>
          <label className="visitors-toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span>{t('Автообновление')}</span>
          </label>
          <button type="button" className="visitors-button" onClick={() => setReloadToken((value) => value + 1)} disabled={refreshing}>
            {t('Обновить')}
          </button>
          <button
            type="button"
            className="visitors-button visitors-button--primary"
            onClick={exportVisits}
            disabled={exporting || !data?.total}
          >
            {exporting ? t('Формируем файл…') : t('Экспорт в Excel')}
          </button>
        </div>
      </header>

      {exportError ? <AdminNotice type="error" onDismiss={() => setExportError('')}>{exportError}</AdminNotice> : null}
      {error && data ? <AdminNotice type="error" onDismiss={() => setError('')}>{error}</AdminNotice> : null}

      <section className="visitors-filters" aria-label={t('Фильтры журнала')}>
        <label>
          {t('Период')}
          <select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(1); }}>
            {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
          </select>
        </label>
        <label>
          {t('Источник')}
          <select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}>
            <option value="">{t('Все источники')}</option>
            {sourceOptions.map((option) => (
              <option key={option.source} value={option.source}>
                {t(visitSourceLabel(option.source))}{option.visits ? ` (${formatVisitNumber(option.visits, locale)})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Роль')}
          <select value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}>
            {ROLE_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{t(option.label)}</option>)}
          </select>
        </label>
        <label className="visitors-search">
          {t('Поиск')}
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Логин, имя, IP или страница')}
          />
        </label>
        <label>
          {t('Сортировка')}
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
          </select>
        </label>
        <label className="visitors-toggle visitors-toggle--filter">
          <input type="checkbox" checked={onlineOnly} onChange={(event) => { setOnlineOnly(event.target.checked); setPage(1); }} />
          <span>{t('Только онлайн')}</span>
        </label>
        <button type="button" className="visitors-button visitors-button--ghost" onClick={resetFilters}>
          {t('Сбросить')}
        </button>
      </section>

      {!data && loading ? <div className="visitors-state">{t('Загружаем журнал посещений…')}</div> : null}
      {!data && !loading && error ? (
        <div className="visitors-state visitors-state--error">
          <p>{error}</p>
          <button type="button" className="visitors-button" onClick={() => setReloadToken((value) => value + 1)}>{t('Повторить')}</button>
        </div>
      ) : null}

      {data ? (
        <>
          <section className="visitors-summary" aria-label={t('Сводка посещений')}>
            {statCards.map((card) => (
              <article key={card.key} className={`visitors-metric visitors-metric--${card.tone}`}>
                <span>{t(card.label)}</span>
                <strong>{card.value}</strong>
                <small>{card.note}</small>
              </article>
            ))}
          </section>

          <div className="visitors-charts">
            <section className="visitors-card visitors-card--wide">
              <div className="visitors-card-head">
                <div>
                  <h2>{t('Посещения по дням')}</h2>
                  <p>{t('Визиты и уникальные посетители по новосибирскому времени')}</p>
                </div>
              </div>
              {dailyData.length ? (
                <div className="visitors-chart-box visitors-chart-box--daily">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(21, 37, 43, .1)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={12} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={38} />
                      <Tooltip
                        formatter={(value, name) => [formatVisitNumber(value, locale), name]}
                        contentStyle={{ borderRadius: 8, border: '1px solid rgba(21, 37, 43, .16)', background: '#fffdf8', fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="visits" name={t('Визиты')} stroke="#4f86a7" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="visitors" name={t('Уникальные')} stroke="#ad6b36" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="visitors-empty">{t('Нет данных за выбранный период')}</div>}
            </section>

            <section className="visitors-card">
              <h2>{t('Источники переходов')}</h2>
              <p>{t('Откуда пришли посетители')}</p>
              {sourceData.length ? (
                <div className="visitors-chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sourceData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(21, 37, 43, .1)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} height={48} angle={-20} textAnchor="end" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={34} />
                      <Tooltip
                        formatter={(value) => [formatVisitNumber(value, locale), t('Визиты')]}
                        contentStyle={{ borderRadius: 8, border: '1px solid rgba(21, 37, 43, .16)', background: '#fffdf8', fontSize: 12 }}
                      />
                      <Bar dataKey="visits" radius={[4, 4, 0, 0]}>
                        {sourceData.map((item, index) => <Cell key={item.source} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="visitors-empty">{t('Нет данных за выбранный период')}</div>}
            </section>

            <section className="visitors-card">
              <h2>{t('Устройства')}</h2>
              <p>{t('С каких устройств заходят')}</p>
              {deviceData.length ? (
                <div className="visitors-chart-box visitors-chart-box--pie">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={deviceData} dataKey="visits" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                        {deviceData.map((item, index) => <Cell key={item.device} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [formatVisitNumber(value, locale), t('Визиты')]}
                        contentStyle={{ borderRadius: 8, border: '1px solid rgba(21, 37, 43, .16)', background: '#fffdf8', fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="visitors-empty">{t('Нет данных за выбранный период')}</div>}
            </section>

            <section className="visitors-card">
              <h2>{t('Роли посетителей')}</h2>
              <p>{t('Сотрудники и гости')}</p>
              {roleData.length ? (
                <div className="visitors-chart-box visitors-chart-box--pie">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={roleData} dataKey="visits" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                        {roleData.map((item) => <Cell key={item.role} fill={ROLE_COLORS[item.role] || CHART_COLORS[5]} />)}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [formatVisitNumber(value, locale), t('Визиты')]}
                        contentStyle={{ borderRadius: 8, border: '1px solid rgba(21, 37, 43, .16)', background: '#fffdf8', fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="visitors-empty">{t('Нет данных за выбранный период')}</div>}
            </section>

            <section className="visitors-card visitors-card--wide">
              <h2>{t('Популярные страницы')}</h2>
              <p>{t('Страницы с наибольшим числом просмотров')}</p>
              {topPages.length ? (
                <div className="visitors-chart-box visitors-chart-box--pages">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topPages} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
                      <CartesianGrid horizontal={false} stroke="rgba(21, 37, 43, .1)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value, name, item) => [formatVisitNumber(value, locale), t('Просмотры')]}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                        contentStyle={{ borderRadius: 8, border: '1px solid rgba(21, 37, 43, .16)', background: '#fffdf8', fontSize: 12 }}
                      />
                      <Bar dataKey="views" fill="#4f86a7" radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="visitors-empty">{t('Нет данных за выбранный период')}</div>}
            </section>
          </div>

          <section className="visitors-card visitors-table-card">
            <div className="visitors-card-head">
              <div>
                <h2>{t('Посещения')}</h2>
                <p>
                  {data.total
                    ? `${t('Показано')} ${rangeStart}–${rangeEnd} ${t('из')} ${formatVisitNumber(data.total, locale)}`
                    : t('За выбранный период посещений нет')}
                </p>
              </div>
              {refreshing ? <span className="visitors-updated is-busy">{t('Обновление…')}</span> : null}
            </div>
            {data.rows.length ? (
              <>
                <div className="visitors-table-wrap">
                  <table className="visitors-table">
                    <thead>
                      <tr>
                        <th>{t('Начало')}</th>
                        <th>{t('Посетитель')}</th>
                        <th>{t('Роль')}</th>
                        <th>{t('Источник')}</th>
                        <th>IP</th>
                        <th>{t('Система')}</th>
                        <th>{t('Страницы')}</th>
                        <th>{t('Время')}</th>
                        <th>{t('Статус')}</th>
                        <th><span className="visitors-sr-only">{t('Подробнее')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => {
                        const online = isVisitOnline(row.last_seen_at, clock);
                        const host = referrerHost(row.referrer);
                        return (
                          <tr key={row.id} className={online ? 'is-online' : undefined}>
                            <td>
                              <strong>{formatVisitTime(row.started_at, locale)}</strong>
                              <small>{formatVisitDay(row.started_at, locale)}</small>
                            </td>
                            <td>
                              <strong>{row.full_name || t('Гость')}</strong>
                              <small>{row.login || t('Без входа')}</small>
                            </td>
                            <td>
                              <span className={`visitors-role visitors-role--${row.role || 'guest'}`}>
                                {t(visitRoleLabel(row.role))}
                              </span>
                            </td>
                            <td className="visitors-source-cell">
                              <strong>{t(visitSourceLabel(row.source))}</strong>
                              <small title={row.referrer || row.landing_path || undefined}>
                                {host || row.landing_path || t('Прямой заход')}
                              </small>
                            </td>
                            <td className="visitors-mono">{row.ip || '—'}</td>
                            <td>
                              <strong>{t(visitOsLabel(row.os))}</strong>
                              <small>{t(visitBrowserLabel(row.browser))} · {t(visitDeviceLabel(row.device))}</small>
                            </td>
                            <td>{formatVisitNumber(row.page_views, locale)}</td>
                            <td>{formatVisitDuration(row.active_seconds, t)}</td>
                            <td>
                              {online
                                ? <span className="visitors-online">{t('Онлайн')}</span>
                                : <small>{t('Был(а)')} {formatVisitTime(row.last_seen_at, locale)}</small>}
                            </td>
                            <td>
                              <button type="button" className="visitors-row-button" onClick={() => openDetail(row.id)}>
                                {t('Подробнее')}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <nav className="visitors-pagination" aria-label={t('Страницы журнала')}>
                  <span>{t('Страница')} {page} {t('из')} {totalPages}</span>
                  <div>
                    <button type="button" onClick={() => setPage(1)} disabled={page <= 1} aria-label={t('Первая страница')}>«</button>
                    <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} aria-label={t('Предыдущая страница')}>‹</button>
                    <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} aria-label={t('Следующая страница')}>›</button>
                    <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} aria-label={t('Последняя страница')}>»</button>
                  </div>
                </nav>
              </>
            ) : (
              <div className="visitors-empty">{t('За выбранный период посещений нет.')}</div>
            )}
          </section>
        </>
      ) : null}

      {selectedId ? (
        <div
          className="visitors-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}
        >
          <div className="visitors-dialog" role="dialog" aria-modal="true" aria-labelledby="visitors-dialog-title">
            <div className="visitors-dialog-head">
              <div>
                <span className="visitors-kicker">{t('Посещение')} #{selectedId}</span>
                <h2 id="visitors-dialog-title">{selectedVisit?.full_name || t('Гость')}</h2>
                <p>
                  {selectedVisit?.login || t('Без входа')}
                  {selectedVisit ? ` · ${t(visitRoleLabel(selectedVisit.role))}` : ''}
                </p>
              </div>
              <button type="button" className="visitors-dialog-close" onClick={closeDetail} aria-label={t('Закрыть')}>×</button>
            </div>

            {detailLoading ? <div className="visitors-state">{t('Загружаем данные посещения…')}</div> : null}
            {detailError ? <AdminNotice type="error">{detailError}</AdminNotice> : null}

            {selectedVisit ? (
              <>
                <div className="visitors-detail-grid">
                  <div><span>{t('Начало')}</span><strong>{formatVisitDateTime(selectedVisit.started_at, locale)}</strong></div>
                  <div><span>{t('Последняя активность')}</span><strong>{formatVisitDateTime(selectedVisit.last_seen_at, locale)}</strong></div>
                  <div><span>{t('Время на сайте')}</span><strong>{formatVisitDuration(selectedVisit.active_seconds, t)}</strong></div>
                  <div><span>{t('Страниц')}</span><strong>{formatVisitNumber(selectedVisit.page_views, locale)}</strong></div>
                  <div><span>{t('Источник')}</span><strong>{t(visitSourceLabel(selectedVisit.source))}</strong></div>
                  <div className="visitors-detail-field--wide">
                    <span>{t('Переход с')}</span>
                    <strong className="visitors-break">{selectedVisit.referrer || t('Прямой заход')}</strong>
                  </div>
                  <div><span>IP</span><strong className="visitors-mono">{selectedVisit.ip || '—'}</strong></div>
                  <div><span>{t('Операционная система')}</span><strong>{t(visitOsLabel(selectedVisit.os))}</strong></div>
                  <div><span>{t('Браузер')}</span><strong>{t(visitBrowserLabel(selectedVisit.browser))}</strong></div>
                  <div><span>{t('Устройство')}</span><strong>{t(visitDeviceLabel(selectedVisit.device))}</strong></div>
                  <div><span>{t('Экран')}</span><strong>{selectedVisit.screen || '—'}</strong></div>
                  <div><span>{t('Язык')}</span><strong>{selectedVisit.language || '—'}</strong></div>
                  <div><span>{t('Часовой пояс')}</span><strong>{selectedVisit.timezone || '—'}</strong></div>
                  <div className="visitors-detail-field--wide">
                    <span>{t('Стартовая страница')}</span>
                    <strong className="visitors-break">{selectedVisit.landing_path || '—'}</strong>
                  </div>
                  <div className="visitors-detail-field--wide">
                    <span>{t('Последняя страница')}</span>
                    <strong className="visitors-break">{selectedVisit.last_path || '—'}</strong>
                  </div>
                  <div className="visitors-detail-field--wide">
                    <span>UTM</span>
                    <strong className="visitors-break">
                      {[selectedVisit.utm_source, selectedVisit.utm_medium, selectedVisit.utm_campaign].filter(Boolean).join(' / ') || '—'}
                    </strong>
                  </div>
                </div>

                <h3>{t('Страницы посещения')}</h3>
                {selectedPages.length ? (
                  <div className="visitors-table-wrap">
                    <table className="visitors-table visitors-table--pages">
                      <thead>
                        <tr>
                          <th>{t('Страница')}</th>
                          <th>{t('Заголовок')}</th>
                          <th>{t('Просмотры')}</th>
                          <th>{t('Последний раз')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPages.map((item) => (
                          <tr key={`${item.path}-${item.last_seen_at}`}>
                            <td className="visitors-break-cell">{item.path}</td>
                            <td className="visitors-break-cell">{item.title || '—'}</td>
                            <td>{formatVisitNumber(item.views, locale)}</td>
                            <td>{formatVisitDateTime(item.last_seen_at, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="visitors-empty">{t('Страницы не зафиксированы')}</div>}

                <details className="visitors-agent">
                  <summary>{t('User-Agent')}</summary>
                  <code>{selectedVisit.user_agent || '—'}</code>
                </details>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

