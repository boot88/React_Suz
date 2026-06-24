import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import './Dashboard.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { useAuth } from '../context/AuthContext';

const STATUS_META = {
  new: { label: 'Новая', icon: '📥' },
  accepted: { label: 'Назначена', icon: '🤝' },
  in_progress: { label: 'В работе', icon: '🛠️' },
  waiting_employee_confirmation: { label: 'Ждёт подтверждения', icon: '👤' },
  done: { label: 'Выполнено', icon: '✅' },
  reopened: { label: 'Переоткрыта', icon: '↩️' }
};
const WORKFLOW_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'queue', label: 'Новые' },
  { id: 'active', label: 'В работе' },
  { id: 'confirmation', label: 'Ждут подтверждения' },
  { id: 'done', label: 'Выполненные' },
  { id: 'overdue', label: 'Просроченные' }
];
const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined || seconds === '') return '—';
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
};


const secondsSince = (dateValue) => {
  if (!dateValue) return 0;
  const started = new Date(dateValue).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
};

const secondsBetweenValues = (startValue, endValue) => {
  if (!startValue || !endValue) return null;
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
};

const isEmployeeCreatedApplication = (app = {}) => (
  app.source === 'chat' || Boolean(String(app.employee_login || '').trim())
);

const getWaitingSeconds = (app = {}) => {
  if (!isEmployeeCreatedApplication(app)) return null;
  const status = app.status || (app.fl ? 'done' : 'new');
  if (app.sla_paused_at && ['new', 'reopened'].includes(status)) return app.sla_paused_seconds ?? null;
  if (app.waiting_seconds != null) return app.waiting_seconds;
  const createdAt = app.created_at || app.data;
  const stoppedAt = app.accepted_at || app.work_started_at || app.start_data || app.resolved_at || app.end_data;
  if (stoppedAt) return secondsBetweenValues(createdAt, stoppedAt);
  if (app.fl || status === 'done') return null;
  return secondsSince(createdAt);
};

const getWorkSeconds = (app = {}) => {
  const status = app.status || (app.fl ? 'done' : 'new');
  if (app.sla_paused_at && ['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(status)) return app.sla_paused_seconds ?? null;
  if (app.work_seconds != null) return app.work_seconds;
  const startedAt = app.work_started_at || app.accepted_at || app.start_data;
  const finishedAt = app.resolved_at || app.end_data || app.employee_confirmed_at;
  if (startedAt && finishedAt) return secondsBetweenValues(startedAt, finishedAt);
  if (startedAt && ['accepted', 'in_progress'].includes(status) && !app.fl) return secondsSince(startedAt);
  return null;
};

const getSlaState = (app = {}) => {
  const status = app.status || (app.fl ? 'done' : 'new');
  const paused = Boolean(app.sla_paused_at);
  if (app.fl || status === 'done') return { level: 'ok', label: 'Выполнена', seconds: 0 };
  if (['new', 'reopened'].includes(status)) {
    const waiting = getWaitingSeconds(app) || 0;
    if (!isEmployeeCreatedApplication(app)) return { level: 'ok', label: 'Ручная заявка', seconds: 0 };
    if (paused) return { level: 'critical', label: 'Просрочка зафиксирована', seconds: waiting, paused: true };
    if (waiting > 15 * 60) return { level: 'critical', label: 'Ожидает более 15 минут', seconds: waiting };
    if (waiting > 5 * 60) return { level: 'warning', label: 'Ожидает более 5 минут', seconds: waiting };
    return { level: 'ok', label: 'В норме', seconds: waiting };
  }
  if (['accepted', 'in_progress'].includes(status)) {
    const work = getWorkSeconds(app) || 0;
    if (paused) return { level: 'critical', label: 'Просрочка зафиксирована', seconds: work, paused: true };
    if (work > 30 * 60) return { level: 'critical', label: 'В работе более 30 минут', seconds: work };
    return { level: 'ok', label: 'В норме', seconds: work };
  }
  if (paused) return { level: 'critical', label: 'Просрочка зафиксирована', seconds: app.sla_paused_seconds || 0, paused: true };
  return { level: 'ok', label: 'В норме', seconds: 0 };
};

const Dashboard = () => {
  const { user } = useAuth();
  const [applications, setApplications] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [exportLoading, setExportLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [workflowMessage, setWorkflowMessage] = useState('');
  const [actionBusyId, setActionBusyId] = useState(null);
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [applicationEvents, setApplicationEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [workflowModal, setWorkflowModal] = useState(null);
  const [toast, setToast] = useState(null);
  const didInitialLoadRef = useRef(false);

  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
  });

  const [filteredStats, setFilteredStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
  });

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateFilterActive, setDateFilterActive] = useState(false);

  const exportToExcel = async () => {
    setExportLoading(true);
    try {
      let url = '/applications/export';
      if (filter !== 'all') url += `?status=${encodeURIComponent(filter)}`;
      if (fromDate) url += `${url.includes('?') ? '&' : '?'}from=${fromDate}`;
      if (toDate) url += `${url.includes('?') ? '&' : '?'}to=${toDate}`;
      if (searchTerm) url += `${url.includes('?') ? '&' : '?'}search=${encodeURIComponent(searchTerm.trim())}`;

      const response = await fetch(`${API_BASE_URL}${url}`);
      const data = await response.json();
      const allApplications = data.applications || [];

      if (allApplications.length === 0) {
        showToast('Нет данных для экспорта', 'warning');
        return;
      }

      const excelData = allApplications.map(app => ({
        'ID': app.id,
        'Клиент': app.name,
        'Кабинет': app.cabinet || '',
        'Телефон': app.N_tel || '',
        'Заявка': app.application,
        'Что сделано': app.process || '',
        'Исполнитель': app.executor || '',
        'Дата подачи': app.data ? new Date(app.data).toLocaleString('ru-RU') : '',
        'Дата начала': app.start_data ? new Date(app.start_data).toLocaleString('ru-RU') : '',
        'Дата окончания': app.end_data ? new Date(app.end_data).toLocaleString('ru-RU') : '',
        'Статус': STATUS_META[app.status]?.label || (app.fl ? 'Выполнено' : 'Новая')
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);

      const colWidths = [
        { wch: 8 },  { wch: 20 }, { wch: 10 }, { wch: 15 },
        { wch: 30 }, { wch: 30 }, { wch: 15 }, { wch: 20 },
        { wch: 20 }, { wch: 20 }, { wch: 12 }
      ];
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Заявки');

      const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
      const fileName = searchTerm 
        ? `заявки_поиск_${searchTerm}_${date}.xlsx`
        : `все_заявки_${date}.xlsx`;

      XLSX.writeFile(workbook, fileName);
      showToast(`Данные экспортированы: ${fileName}`, 'success');

    } catch (error) {
      console.error('Ошибка при экспорте:', error);
      showToast('Произошла ошибка при экспорте данных', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  const fetchGeneralStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/applications?limit=1`);
      const data = await response.json();
      setStats(data.stats || { total: 0, completed: 0, pending: 0 });
      return true;
    } catch (error) {
      console.error('Ошибка загрузки статистики:', error);
      return false;
    }
  };

  const fetchApplications = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      let url = `/applications?page=${currentPage}&limit=${limit}`;
      
      if (searchTerm.trim()) {
        url += `&search=${encodeURIComponent(searchTerm.trim())}`;
      }
      
      if (filter !== 'all') url += `&status=${encodeURIComponent(filter)}`;
      if (dateFilterActive) {
        if (fromDate) url += `&from=${fromDate}`;
        if (toDate) url += `&to=${toDate}`;
      }

      const response = await fetch(`${API_BASE_URL}${url}`);
      const data = await response.json();

      const nextStats = data.stats || { total: 0, completed: 0, pending: 0 };
      const nextApplications = data.applications || [];
      setApplications(nextApplications);
      setTotalPages(data.totalPages || 1);
      setFilteredStats(nextStats);
      if (!searchTerm.trim() && !dateFilterActive && filter === 'all') {
        setStats(nextStats);
      }
      window.dispatchEvent(new Event('applications:refresh'));
      return true;
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      // Убираем блокирующий alert при стартовой загрузке,
      // чтобы интерфейс не показывал всплывающее окно подтверждения.
      if (!silent) {
        setApplications([]);
        setFilteredStats({ total: 0, completed: 0, pending: 0 });
      }
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleSearch = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const clearSearch = () => {
    setSearchTerm('');
    setCurrentPage(1);
  };

  const markApplicationsViewed = (ids) => {
    const safeIds = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map(String);
    if (safeIds.length > 0) {
      window.dispatchEvent(new CustomEvent('applications:viewed', { detail: { ids: safeIds } }));
    }
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 3600);
  };

  const fetchApplicationEvents = async (applicationId) => {
    if (!applicationId) return;
    setEventsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/applications/${applicationId}/events`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить историю');
      setApplicationEvents(Array.isArray(data.events) ? data.events : []);
    } catch (error) {
      showToast(error.message || 'Не удалось загрузить историю заявки', 'error');
      setApplicationEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  const openApplicationPanel = async (app) => {
    setSelectedApplication(app);
    await fetchApplicationEvents(app.id);
    if (['new', 'reopened'].includes(app.status || 'new')) {
      try {
        await fetch(`${API_BASE_URL}/applications/${app.id}/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_login: user?.username || user?.name || 'admin' })
        });
        markApplicationsViewed(app.id);
      } catch (error) {
        console.error('Не удалось отметить просмотр заявки:', error);
      }
    }
  };

  const closeApplicationPanel = () => {
    setSelectedApplication(null);
    setApplicationEvents([]);
  };

  const openAcceptModal = (app) => {
    setWorkflowModal({
      type: 'accept',
      app,
      values: {
        executor: app.executor || user?.name || user?.username || 'Администратор',
        eta_minutes: app.eta_minutes || 10,
        admin_comment: app.admin_comment || 'К вам подойдут через 10 минут'
      }
    });
  };

  const openResolveModal = (app) => {
    setWorkflowModal({
      type: 'resolve',
      app,
      values: { process: app.process || 'Проблема устранена' }
    });
  };

  const updateWorkflowModalValue = (field, value) => {
    setWorkflowModal((prev) => prev ? { ...prev, values: { ...prev.values, [field]: value } } : prev);
  };

  useEffect(() => {
    let isCancelled = false;
    const retryDelays = [200, 800, 1800];
    const retryTimers = [];

    const loadInitialData = async () => {
      await Promise.all([fetchGeneralStats(), fetchApplications()]);
      didInitialLoadRef.current = true;

      retryDelays.forEach((delay) => {
        const timer = setTimeout(() => {
          if (isCancelled) return;
          fetchGeneralStats();
          fetchApplications({ silent: true });
        }, delay);
        retryTimers.push(timer);
      });
    };

    loadInitialData();

    return () => {
      isCancelled = true;
      retryTimers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInitialLoadRef.current) return undefined;

    const timer = setTimeout(() => {
      fetchApplications({ silent: true });
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, limit, filter, fromDate, toDate, dateFilterActive, searchTerm]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchApplications();
        fetchGeneralStats();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDateInput = (date) => date.toISOString().slice(0, 10);

  const setFilterAndResetPage = (newFilter) => {
    setFilter(newFilter);
    setCurrentPage(1);
  };

  const applyFilters = () => {
    setCurrentPage(1);
    setDateFilterActive(Boolean(fromDate || toDate));
  };

  const applyQuickDateRange = (range) => {
    const today = new Date();
    const start = new Date(today);

    if (range === 'today') {
      setFromDate(formatDateInput(today));
      setToDate(formatDateInput(today));
    }

    if (range === 'week') {
      start.setDate(today.getDate() - 6);
      setFromDate(formatDateInput(start));
      setToDate(formatDateInput(today));
    }

    if (range === 'month') {
      start.setDate(today.getDate() - 29);
      setFromDate(formatDateInput(start));
      setToDate(formatDateInput(today));
    }

    setDateFilterActive(true);
    setCurrentPage(1);
  };

  const clearDateFilter = () => {
    setFromDate('');
    setToDate('');
    setDateFilterActive(false);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilter('all');
    setFromDate('');
    setToDate('');
    setCurrentPage(1);
    setDateFilterActive(false);
    setSearchTerm('');
  };

  const activeFilterChips = [
    filter !== 'all' ? { key: 'status', label: WORKFLOW_FILTERS.find((item) => item.id === filter)?.label || 'Раздел', onRemove: () => setFilterAndResetPage('all') } : null,
    dateFilterActive && fromDate ? { key: 'from', label: `с ${fromDate}`, onRemove: () => { setFromDate(''); setDateFilterActive(Boolean(toDate)); setCurrentPage(1); } } : null,
    dateFilterActive && toDate ? { key: 'to', label: `по ${toDate}`, onRemove: () => { setToDate(''); setDateFilterActive(Boolean(fromDate)); setCurrentPage(1); } } : null,
    searchTerm ? { key: 'search', label: `поиск: ${searchTerm}`, onRemove: clearSearch } : null
  ].filter(Boolean);

  const getVisiblePages = () => {
    const visiblePages = 6;
    const halfVisible = Math.floor(visiblePages / 2);
    
    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, startPage + visiblePages - 1);
    
    if (endPage - startPage + 1 < visiblePages) {
      startPage = Math.max(1, endPage - visiblePages + 1);
    }
    
    return Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  };

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const goToFirstPage = () => goToPage(1);
  const goToLastPage = () => goToPage(totalPages);
  const goToPrevPage = () => goToPage(currentPage - 1);
  const goToNextPage = () => goToPage(currentPage + 1);

  const formatTime = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatShortDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    });
  };

  const formatTimeRange = (app) => {
    const start = formatTime(app.start_data || app.work_started_at);
    const end = formatTime(app.end_data || app.resolved_at);
    if (start === '—' && end === '—') return '—';
    if (start !== '—' && end !== '—') return `${start} — ${end}`;
    if (start !== '—') return `${start} — …`;
    return `… — ${end}`;
  };

  const formatCompactDuration = (seconds) => {
    if (seconds === null || seconds === undefined || seconds === '') return '—';
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    if (safe < 60) return '<1 мин';
    const minutes = Math.round(safe / 60);
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  };

  const getTableTimers = (app = {}) => {
    return {
      waitingSeconds: getWaitingSeconds(app),
      workSeconds: getWorkSeconds(app)
    };
  };

  const getStatusLabel = (app) => {
    const status = app.status || (app.fl ? 'done' : 'new');
    const meta = STATUS_META[status] || STATUS_META.new;
    return <span className={`status-badge status-${status}`}><span className="status-icon">{meta.icon}</span>{meta.label}</span>;
  };

  const runWorkflowAction = async (app, action, extraPayload = {}) => {
    const payload = { actor: user?.username || user?.name || 'admin', ...extraPayload };
    if (action === 'accept') {
      payload.accepted_by = user?.username || 'admin';
    }

    setActionBusyId(app.id);
    setWorkflowMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/applications/${app.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось изменить статус');
      setApplications((prev) => prev.map((item) => (item.id === app.id ? data.application : item)));
      setSelectedApplication((prev) => (prev?.id === app.id ? data.application : prev));
      setWorkflowMessage(data.message || 'Статус заявки обновлён');
      showToast(data.message || 'Статус заявки обновлён', 'success');
      setWorkflowModal(null);
      fetchGeneralStats();
      fetchApplications();
      fetchApplicationEvents(app.id);
    } catch (error) {
      setWorkflowMessage(error.message || 'Ошибка изменения статуса');
      showToast(error.message || 'Ошибка изменения статуса', 'error');
    } finally {
      setActionBusyId(null);
    }
  };

  const submitWorkflowModal = (event) => {
    event.preventDefault();
    if (!workflowModal?.app) return;
    if (workflowModal.type === 'accept') {
      runWorkflowAction(workflowModal.app, 'accept', {
        executor: workflowModal.values.executor,
        eta_minutes: Number(workflowModal.values.eta_minutes) || 10,
        admin_comment: workflowModal.values.admin_comment
      });
    }
    if (workflowModal.type === 'resolve') {
      runWorkflowAction(workflowModal.app, 'resolve', { process: workflowModal.values.process });
    }
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    return (
      <div className="pagination">
        <button
          onClick={goToFirstPage}
          disabled={currentPage === 1}
          className="pagination-btn"
          title="Первая страница"
        >
          ««
        </button>
        
        <button
          onClick={goToPrevPage}
          disabled={currentPage === 1}
          className="pagination-btn"
          title="Предыдущая страница"
        >
          «
        </button>

        {getVisiblePages().map((page) => (
          <button
            key={page}
            onClick={() => goToPage(page)}
            className={`pagination-btn ${currentPage === page ? 'active' : ''}`}
          >
            {page}
          </button>
        ))}

        <button
          onClick={goToNextPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title="Следующая страница"
        >
          »
        </button>
        
        <button
          onClick={goToLastPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title="Последняя страница"
        >
          »»
        </button>

        <span className="pagination-info">
          Страница {currentPage} из {totalPages}
        </span>
      </div>
    );
  };

  const statCards = [
    { id: 'queue', label: '📥 Новые', value: stats.queue || 0, hint: 'Ждут просмотра' },
    { id: 'active', label: '🛠️ В работе', value: stats.active || 0, hint: 'Назначены или выполняются' },
    { id: 'confirmation', label: '👤 Ждут подтверждения', value: stats.confirmation || 0, hint: 'Нужно подтверждение сотрудника' },
    { id: 'overdue', label: '⚠️ Просроченные', value: stats.overdue || 0, hint: 'Нарушен SLA', tone: 'danger' }
  ];

  return (
    <div className="dashboard-container">
      {/* Заголовок */}
      <div className="dashboard-header">
        <h1>⚗️ Панель управления — Заявки</h1>
        <button
          onClick={exportToExcel}
          disabled={exportLoading || stats.total === 0}
          className="export-btn"
          title="Экспортировать данные в Excel"
        >
          {exportLoading ? (
            <>
              <span className="button-spinner"></span>
              Экспорт...
            </>
          ) : (
            <>
              <span className="export-icon">📥</span>
              Экспорт в Excel
            </>
          )}
        </button>
      </div>

      {/* Статистика */}
      <div className="stats-grid dashboard-stats-expanded">
        <div
          className={`stat-card ${filter === 'all' && !dateFilterActive && !searchTerm ? 'stat-active' : ''}`}
          onClick={clearFilters}
        >
          <span className="stat-label">📊 Всего заявок</span>
          <div className="stat-number">{stats.total}</div>
          <small>Всего в системе</small>
        </div>
        {statCards.map((card) => (
          <div
            key={card.id}
            className={`stat-card ${card.tone === 'danger' ? 'stat-danger' : ''} ${filter === card.id ? 'stat-active' : ''}`}
            onClick={() => setFilterAndResetPage(card.id)}
          >
            <span className="stat-label">{card.label}</span>
            <div className="stat-number">{card.value}</div>
            <small>{card.hint}</small>
          </div>
        ))}
      </div>

      {workflowMessage && <div className="workflow-message">{workflowMessage}</div>}

      {/* Фильтры */}
      <div className="filters-section filters-section-compact">
        <div className="filters-group period-filter-card">
          <div className="filter-card-head">
            <div>
              <span className="eyebrow">Период заявок</span>
              <h3>Быстрый фильтр по датам</h3>
            </div>
            <button type="button" onClick={clearFilters} className="btn-secondary compact-reset">Сбросить всё</button>
          </div>

          <div className="date-preset-row">
            <button type="button" onClick={() => applyQuickDateRange('today')}>Сегодня</button>
            <button type="button" onClick={() => applyQuickDateRange('week')}>7 дней</button>
            <button type="button" onClick={() => applyQuickDateRange('month')}>30 дней</button>
            <details className="custom-date-panel">
              <summary>Произвольный период</summary>
              <div className="date-filters">
                <div className="filter-group">
                  <label>От</label>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div className="filter-group">
                  <label>До</label>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <div className="filter-actions">
                  <button type="button" onClick={applyFilters} className="btn-primary">Применить</button>
                  <button type="button" onClick={clearDateFilter} className="btn-secondary">Сбросить период</button>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="active-filter-chips">
          <strong>Активные фильтры:</strong>
          {activeFilterChips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.onRemove}>{chip.label} ×</button>
          ))}
          <button type="button" className="clear-all-chip" onClick={clearFilters}>Сбросить всё</button>
        </div>
      )}

      {/* Таблица */}
      {loading ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Загрузка данных...</p>
        </div>
      ) : (
        <>
          {/* Заголовок таблицы с информацией о результатах */}
          <div className="table-header table-header-modern">
            <div>
              <h3>
                <span className="science-icon">📋</span>
                Список заявок
                {applications.length > 0 && (
                  <span className="table-count">
                    ({applications.length} из {filteredStats.total})
                  </span>
                )}
              </h3>
              <p>Поиск работает по заявке, кабинету, сотруднику, телефону и исполнителю.</p>
            </div>
            <div className="table-tools">
              <div className="table-search">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Поиск: заявка, кабинет, сотрудник..."
                  className="search-input"
                />
                {searchTerm && <button type="button" onClick={clearSearch} className="clear-search" title="Очистить поиск">×</button>}
              </div>
              <label className="page-size-control">
                <span>На странице</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>
          </div>

          <div className="table-container">
            <div className="table-responsive">
              <table className="applications-table">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Заявка</th>
                    <th>Исполнитель</th>
                    <th>Дата</th>
                    <th>Время</th>
                    <th>Таймер</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.length > 0 ? (
                    applications.map((app) => (
                      <tr
                        key={app.id}
                        className={`${app.fl ? 'row-completed' : `row-${app.status || 'new'}`} row-sla-${getSlaState(app).level} ${selectedApplication?.id === app.id ? 'row-selected' : ''}`}
                        onClick={() => openApplicationPanel(app)}
                      >
                        <td className="cell-person">
                          <strong>{app.name || 'Сотрудник'}</strong>
                          <span>каб. {app.cabinet || '—'}{app.N_tel ? ` · ${app.N_tel}` : ''}</span>
                        </td>
						
                        <td 
                             className="cell-application" 
                             data-tooltip={app.application}
                             onMouseMove={(e) => {
                               document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
                               document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
                             }}
                        >
                             {app.application}
                        </td>

                        <td className="cell-executor">
                          {app.executor ? (
                            <>
                              {app.executor.split('\n').map((name, index, array) => {
                                const parts = name.split(/\s+/);
                                const result = [];
                                for (let i = 0; i < parts.length; i += 2) {
                                  if (i > 0) {
                                    result.push(<br key={`br-${i}`} />);
                                  }
                                  if (i + 1 < parts.length) {
                                    result.push(
                                      <span key={i}>
                                        {parts[i]} {parts[i + 1]}
                                      </span>
                                    );
                                  } else {
                                    result.push(<span key={i}>{parts[i]}</span>);
                                  }
                                }
                                
                                return (
                                  <span key={index} className="executor-name">
                                    {result}
                                    {index < array.length - 1 && <br />}
                                  </span>
                                );
                              })}
                            </>
                          ) : (
                            'Не назначен'
                          )}
                        </td>
                        
                        <td className="cell-date">{formatShortDate(app.data)}</td>
                        <td className="cell-date cell-time-range">{formatTimeRange(app)}</td>
                        <td className="cell-timers">
                          {(() => {
                            const { waitingSeconds, workSeconds } = getTableTimers(app);
                            return (
                              <>
                                <div>Ожидание: {formatCompactDuration(waitingSeconds)}</div>
                                <div>Работа: {formatCompactDuration(workSeconds)}</div>
                              </>
                            );
                          })()}
                          {app.sla_paused_at && <small>Таймер остановлен</small>}
                        </td>
                        <td>{getStatusLabel(app)}</td>
                        <td className="cell-actions"><div className="workflow-actions">
                          <button type="button" disabled={actionBusyId === app.id} onClick={(event) => { event.stopPropagation(); openApplicationPanel(app); }}>Открыть</button>
                          {app.employee_login && <a onClick={(event) => event.stopPropagation()} href={`/employee?dialog=${encodeURIComponent(app.employee_login)}&application=${app.id}`}>Чат</a>}
                        </div></td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" className="no-data">
                        <span className="science-icon">🔍</span>
                        {searchTerm 
                          ? `Не найдено заявок по запросу "${searchTerm}"`
                          : 'Нет заявок по данному фильтру'
                        }
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Пагинация */}
          {renderPagination()}
        </>
      )}


      {selectedApplication && (
        <aside className="application-side-panel" aria-label="Карточка заявки">
          <button type="button" className="side-panel-close" onClick={closeApplicationPanel}>×</button>
          <div className="side-panel-head">
            <span>{getStatusLabel(selectedApplication)}</span>
            <h2>Заявка #{selectedApplication.id}</h2>
            <p>{selectedApplication.name} · каб. {selectedApplication.cabinet || '—'} · {selectedApplication.N_tel || 'телефон —'}</p>
          </div>
          <div className={`sla-card sla-${getSlaState(selectedApplication).level}`}>
            <strong>{getSlaState(selectedApplication).label}</strong>
            <span>{formatDuration(getSlaState(selectedApplication).seconds)}</span>
          </div>
          <div className="side-panel-section">
            <h3>Описание</h3>
            <p>{selectedApplication.application}</p>
          </div>
          <div className="side-panel-grid">
            <div><strong>Категория</strong><span>{selectedApplication.category || '—'}</span></div>
            <div><strong>Приоритет</strong><span>{selectedApplication.priority || 'Обычный'}</span></div>
            <div><strong>Источник</strong><span>{selectedApplication.source || 'admin'}</span></div>
            <div><strong>Исполнитель</strong><span>{selectedApplication.executor || 'Не назначен'}</span></div>
            <div><strong>Ожидание</strong><span>{formatDuration(getWaitingSeconds(selectedApplication))}</span></div>
            <div><strong>Работа</strong><span>{formatDuration(getWorkSeconds(selectedApplication))}</span></div>
          </div>
          <div className="side-panel-section">
            <h3>Комментарий администратора</h3>
            <p>{selectedApplication.admin_comment || 'Комментарий пока не добавлен.'}</p>
          </div>
          <div className="side-panel-section">
            <h3>Что сделано</h3>
            <p>{selectedApplication.process || 'Пока не заполнено.'}</p>
          </div>
          <div className="side-panel-actions">
            {['new', 'reopened'].includes(selectedApplication.status || 'new') && <button type="button" onClick={() => openAcceptModal(selectedApplication)}>Взять в работу</button>}
            {selectedApplication.status === 'accepted' && <button type="button" onClick={() => runWorkflowAction(selectedApplication, 'start-work')}>Запустить таймер</button>}
            {['accepted', 'in_progress'].includes(selectedApplication.status) && <button type="button" onClick={() => openResolveModal(selectedApplication)}>Что сделано</button>}
            {getSlaState(selectedApplication).level === 'critical' && !getSlaState(selectedApplication).paused && <button type="button" onClick={() => runWorkflowAction(selectedApplication, 'pause-overdue')}>Остановить таймер просрочки</button>}
            {getSlaState(selectedApplication).paused && <button type="button" disabled>Таймер просрочки остановлен</button>}
            {selectedApplication.employee_login && <a href={`/employee?dialog=${encodeURIComponent(selectedApplication.employee_login)}&application=${selectedApplication.id}`}>Открыть чат</a>}
          </div>
          <div className="side-panel-section">
            <h3>История действий</h3>
            {eventsLoading && <p>Загружаем историю…</p>}
            {!eventsLoading && applicationEvents.length === 0 && <p>История пока пустая.</p>}
            <div className="event-list">
              {applicationEvents.map((event) => (
                <div key={event.id} className="event-item">
                  <strong>{event.event_type}</strong>
                  <span>{event.actor_login || '—'} · {event.created_at ? new Date(event.created_at).toLocaleString('ru-RU') : '—'}</span>
                  {event.comment && <p>{event.comment}</p>}
                </div>
              ))}
            </div>
          </div>
        </aside>
      )}

      {workflowModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setWorkflowModal(null)}>
          <form className="workflow-modal" onSubmit={submitWorkflowModal} onMouseDown={(event) => event.stopPropagation()}>
            <h2>{workflowModal.type === 'accept' ? 'Взять заявку в работу' : 'Что сделано'}</h2>
            {workflowModal.type === 'accept' ? (
              <>
                <label>Исполнитель<input value={workflowModal.values.executor} onChange={(event) => updateWorkflowModalValue('executor', event.target.value)} required /></label>
                <label>Подойдут через, минут<input type="number" min="1" value={workflowModal.values.eta_minutes} onChange={(event) => updateWorkflowModalValue('eta_minutes', event.target.value)} required /></label>
                <label>Комментарий сотруднику<textarea rows={4} value={workflowModal.values.admin_comment} onChange={(event) => updateWorkflowModalValue('admin_comment', event.target.value)} /></label>
              </>
            ) : (
              <label>Что было сделано<textarea rows={5} value={workflowModal.values.process} onChange={(event) => updateWorkflowModalValue('process', event.target.value)} required /></label>
            )}
            <div className="modal-actions"><button type="button" onClick={() => setWorkflowModal(null)}>Отмена</button><button type="submit" disabled={actionBusyId === workflowModal.app.id}>{actionBusyId === workflowModal.app.id ? 'Сохраняем…' : 'Сохранить'}</button></div>
          </form>
        </div>
      )}

      {toast && <div className={`dashboard-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
};

export default Dashboard;
