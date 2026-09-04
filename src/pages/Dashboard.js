import React, { useState, useEffect, useMemo, useRef } from 'react';
import './Dashboard.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import {
  APPLICATION_TIME_ZONE,
  formatApplicationDateTime,
  formatApplicationDuration,
  getApplicationTiming
} from '../utils/applicationTime';

const STATUS_META = {
  new: { label: 'Новая', icon: '📥' },
  accepted: { label: 'Назначена', icon: '🤝' },
  in_progress: { label: 'В работе', icon: '🛠️' },
  waiting_employee_confirmation: { label: 'В работе', icon: '🛠️' },
  done: { label: 'Выполнено', icon: '✅' },
  reopened: { label: 'Переоткрыта', icon: '↩️' }
};
const WORKFLOW_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'queue', label: 'Новые' },
  { id: 'inwork', label: 'В работе' },
  { id: 'my', label: 'Мои' },
  { id: 'active', label: 'В работе' },
  { id: 'unassigned', label: 'Без исполнителя' },
  { id: 'done', label: 'Выполненные' },
  { id: 'overdue', label: 'Просроченные' }
];
const QUEUE_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'queue', label: 'Новые', icon: '📥' },
  { id: 'inwork', label: 'В работе', icon: '🛠️' },
  { id: 'my', label: 'Мои', icon: '👤' },
  { id: 'unassigned', label: 'Без исполнителя', icon: '🧭' },
  { id: 'done', label: 'Выполненные', icon: '✅' },
];
const SORT_OPTIONS = [
  { id: 'date_desc', label: 'Дата: новые сверху' },
  { id: 'status', label: 'Статус' },
  { id: 'date_asc', label: 'Дата: старые сверху' },
  { id: 'executor', label: 'Исполнитель' }
];
const TABLE_STATUS_ORDER = {
  new: 1,
  reopened: 2,
  accepted: 3,
  in_progress: 4,
  waiting_employee_confirmation: 5,
  done: 6
};
const DASHBOARD_COLUMNS_KEY = 'dashboard.visibleColumns.v1';
const DASHBOARD_COMPACT_KEY = 'dashboard.compactMode.v1';
const DEFAULT_DASHBOARD_COLUMNS = ['employee', 'request', 'executor', 'created', 'status'];
const DASHBOARD_COLUMNS = [
  { id: 'employee', label: 'Сотрудник' },
  { id: 'request', label: 'Заявка' },
  { id: 'executor', label: 'Исполнитель' },
  { id: 'created', label: 'Дата' },
  { id: 'status', label: 'Статус' }
];
const SAVED_DASHBOARD_VIEWS = [
  { id: 'my', label: 'Мои заявки', filter: 'my', sort: 'date_desc' },
  { id: 'it', label: 'IT', filter: 'all', sort: 'date_desc', search: 'IT' },
  { id: 'today', label: 'Сегодня', filter: 'all', sort: 'date_desc', dateRange: 'today' }
];
const readVisibleColumns = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(DASHBOARD_COLUMNS_KEY) || '[]');
    const allowed = new Set(DASHBOARD_COLUMNS.map((column) => column.id));
    const filtered = Array.isArray(saved) ? saved.filter((column) => allowed.has(column)) : [];
    return filtered.length > 0 ? filtered : DEFAULT_DASHBOARD_COLUMNS;
  } catch (error) {
    return DEFAULT_DASHBOARD_COLUMNS;
  }
};
// Три ключевых времени заявки и производные длительности.
const getApplicationTimes = (app = {}, now = Date.now()) => {
  const timing = getApplicationTiming(app, now);
  return {
    ...timing,
    waitSeconds: timing.waitingSeconds
  };
};

const getCumulativeWorkSeconds = (app = {}, now = Date.now()) => {
  const timing = getApplicationTiming(app, now);
  const completed = Math.max(0, Number(app.work_seconds) || 0);
  const status = getApplicationStatus(app);
  if (!app.fl && ['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(status)) {
    return completed + Math.max(0, Number(timing.workSeconds) || 0);
  }
  return completed || timing.workSeconds;
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
const isAdministratorCreatedApplication = (app = {}) => !isEmployeeCreatedApplication(app);

const getApplicationStatus = (app = {}) => app.status || (app.fl ? 'done' : 'new');
const isQueueApplication = (app = {}) => ['new', 'reopened'].includes(getApplicationStatus(app));
const isInWorkApplication = (app = {}) => ['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(getApplicationStatus(app));

const matchesDashboardFilter = (app = {}, filter = 'all', assignee = '') => {
  const status = getApplicationStatus(app);
  if (filter === 'all') return true;
  if (filter === 'queue') return isQueueApplication(app);
  if (filter === 'inwork') return isInWorkApplication(app);
  if (filter === 'active') return ['accepted', 'in_progress'].includes(status);
  if (filter === 'done') return status === 'done' || Boolean(app.fl);
  if (filter === 'confirmation') return status === 'waiting_employee_confirmation';
  if (filter === 'unassigned') return !app.fl && !String(app.executor || app.accepted_by || '').trim();
  if (filter === 'my') {
    const target = String(assignee || '').trim().toLowerCase();
    return target && (
      String(app.executor || '').toLowerCase().includes(target)
      || String(app.accepted_by || '').toLowerCase() === target
    );
  }
  return status === filter;
};

const updateStatsForApplicationTransition = (current = {}, before = {}, after = {}) => {
  const next = { ...current };
  const buckets = {
    completed: (app) => getApplicationStatus(app) === 'done' || Boolean(app.fl),
    pending: (app) => !app.fl && ['new', 'accepted', 'in_progress', 'waiting_employee_confirmation', 'reopened'].includes(getApplicationStatus(app)),
    queue: isQueueApplication,
    accepted: (app) => getApplicationStatus(app) === 'accepted',
    in_progress: (app) => getApplicationStatus(app) === 'in_progress',
    active: (app) => ['accepted', 'in_progress'].includes(getApplicationStatus(app)),
    inwork: isInWorkApplication,
    confirmation: (app) => getApplicationStatus(app) === 'waiting_employee_confirmation'
  };
  Object.entries(buckets).forEach(([key, test]) => {
    const delta = Number(test(after)) - Number(test(before));
    if (delta !== 0 || Object.prototype.hasOwnProperty.call(next, key)) {
      next[key] = Math.max(0, Number(next[key] || 0) + delta);
    }
  });
  return next;
};

const getOpenChatHref = (app = {}) => {
  const params = new URLSearchParams();
  if (app.employee_login) params.set('dialog', app.employee_login);
  if (app.id) params.set('application', app.id);
  if (app.chat_thread_id) params.set('thread', app.chat_thread_id);
  return `/employee?${params.toString()}`;
};

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
  if (app.work_seconds != null) {
    if (!app.fl && ['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(status)) {
      return Number(app.work_seconds || 0) + secondsSince(app.resolved_at || app.work_started_at || app.accepted_at || app.start_data);
    }
    return app.work_seconds;
  }
  const startedAt = app.work_started_at || app.accepted_at || (app.accepted_by ? app.start_data : null);
  const finishedAt = app.resolved_at || app.end_data || app.employee_confirmed_at;
  if (startedAt && finishedAt) return secondsBetweenValues(startedAt, finishedAt);
  if (startedAt && ['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(status) && !app.fl) return secondsSince(startedAt);
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

  const downloadBlob = (blob, fileName) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [workflowMessage, setWorkflowMessage] = useState('');
  const [actionBusyId, setActionBusyId] = useState(null);
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [sortMode, setSortMode] = useState(() => localStorage.getItem('dashboard.sortMode') || 'date_desc');
  const [visibleColumns, setVisibleColumns] = useState(readVisibleColumns);
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem(DASHBOARD_COMPACT_KEY) === 'true');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('dashboard.viewMode') || 'timeline');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkExecutor, setBulkExecutor] = useState('');
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [applicationEvents, setApplicationEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [workflowModal, setWorkflowModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [dashboardNow, setDashboardNow] = useState(Date.now());
  const applicationsRequestIdRef = useRef(0);

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
      // Экспортируем ровно то, что сейчас отфильтровано в таблице
      // (статус/очередь, период, поиск).
      const params = new URLSearchParams();
      if (filter !== 'all') {
        if (['my', 'unassigned'].includes(filter)) {
          params.set('queue', filter);
          if (filter === 'my') {
            params.set('assignee', user?.name || user?.username || '');
          }
        } else {
          params.set('status', filter);
        }
      }
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (searchTerm && searchTerm.trim()) params.set('search', searchTerm.trim());

      let url = '/applications/export';
      const query = params.toString();
      if (query) url += `?${query}`;

      const response = await authFetch(`${API_BASE_URL}${url}`);
      const data = await response.json();
      const allApplications = data.applications || [];

      if (allApplications.length === 0) {
        showToast('Нет данных для экспорта', 'warning');
        return;
      }

      const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
      const fileName = searchTerm
        ? `заявки_поиск_${searchTerm}_${date}.xlsx`
        : `все_заявки_${date}.xlsx`;

      const exportResponse = await authFetch(`${API_BASE_URL}/applications/export-xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applications: allApplications, sheetName: 'Заявки' })
      });

      if (!exportResponse.ok) {
        const errorData = await exportResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Не удалось сформировать файл Excel');
      }

      const blob = await exportResponse.blob();
      downloadBlob(blob, fileName);
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
      const response = await authFetch(`${API_BASE_URL}/applications?limit=1`);
      const data = await response.json();
      setStats(data.stats || { total: 0, completed: 0, pending: 0 });
      return true;
    } catch (error) {
      console.error('Ошибка загрузки статистики:', error);
      return false;
    }
  };

  const fetchApplications = async ({ silent = false } = {}) => {
    const requestId = applicationsRequestIdRef.current + 1;
    applicationsRequestIdRef.current = requestId;
    if (!silent) {
      setLoading(true);
    }
    try {
      let url = `/applications?page=${currentPage}&limit=${limit}`;

      if (searchTerm.trim()) {
        url += `&search=${encodeURIComponent(searchTerm.trim())}`;
      }

      if (filter !== 'all') {
        if (['my', 'unassigned'].includes(filter)) {
          url += `&queue=${encodeURIComponent(filter)}`;
          if (filter === 'my') {
            url += `&assignee=${encodeURIComponent(user?.name || user?.username || '')}`;
          }
        } else {
          url += `&status=${encodeURIComponent(filter)}`;
        }
      }
      url += `&sort=${encodeURIComponent(sortMode)}`;
      if (dateFilterActive) {
        if (fromDate) url += `&from=${fromDate}`;
        if (toDate) url += `&to=${toDate}`;
      }

      const response = await authFetch(`${API_BASE_URL}${url}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка загрузки заявок');
      if (requestId !== applicationsRequestIdRef.current) return false;

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
      if (requestId !== applicationsRequestIdRef.current) return false;
      console.error('Ошибка загрузки:', error);
      // Убираем блокирующий alert при стартовой загрузке,
      // чтобы интерфейс не показывал всплывающее окно подтверждения.
      if (!silent) {
        setApplications([]);
        setFilteredStats({ total: 0, completed: 0, pending: 0 });
      }
      return false;
    } finally {
      if (!silent && requestId === applicationsRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const handleSearch = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
    setApplications([]);
    setLoading(true);
  };

  const clearSearch = () => {
    setSearchTerm('');
    setCurrentPage(1);
    setApplications([]);
    setLoading(true);
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
      const response = await authFetch(`${API_BASE_URL}/applications/${applicationId}/events`);
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
        await authFetch(`${API_BASE_URL}/applications/${app.id}/view`, {
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

  const updateWorkflowModalValue = (field, value) => {
    setWorkflowModal((prev) => prev ? { ...prev, values: { ...prev.values, [field]: value } } : prev);
  };

  useEffect(() => {
    fetchGeneralStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchApplications();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, limit, filter, fromDate, toDate, dateFilterActive, searchTerm, sortMode]);

  useEffect(() => () => {
    applicationsRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (!selectedApplication || getApplicationStatus(selectedApplication) === 'done') return undefined;
    setDashboardNow(Date.now());
    const timer = window.setInterval(() => setDashboardNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [selectedApplication]);

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
  }, [currentPage, limit, filter, fromDate, toDate, dateFilterActive, searchTerm, sortMode]);

  const formatDateInput = (date) => date.toISOString().slice(0, 10);

  const setFilterAndResetPage = (newFilter) => {
    setFilter(newFilter);
    setCurrentPage(1);
    setApplications([]);
    setLoading(true);
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
    setApplications([]);
    setLoading(true);
  };

  const isColumnVisible = (columnId) => visibleColumns.includes(columnId);

  const toggleColumn = (columnId) => {
    setVisibleColumns((current) => {
      const next = current.includes(columnId)
        ? current.filter((item) => item !== columnId)
        : [...current, columnId];
      const safeNext = next.length > 0 ? next : ['request'];
      localStorage.setItem(DASHBOARD_COLUMNS_KEY, JSON.stringify(safeNext));
      return safeNext;
    });
  };

  const toggleCompactMode = () => {
    setCompactMode((current) => {
      localStorage.setItem(DASHBOARD_COMPACT_KEY, String(!current));
      return !current;
    });
  };

  const applySavedView = (view) => {
    setFilter(view.filter);
    setSortMode(view.sort);
    setSearchTerm(view.search || '');
    setCurrentPage(1);
    if (view.dateRange === 'today') {
      const today = new Date().toISOString().split('T')[0];
      setFromDate(today);
      setToDate(today);
      setDateFilterActive(true);
    } else {
      setFromDate('');
      setToDate('');
      setDateFilterActive(false);
    }
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
    return new Date(dateString).toLocaleTimeString('ru-RU', { timeZone: APPLICATION_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isDateOnlyValue = (dateString) => typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString.trim());
  const isMidnightValue = (date) => date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;

  const formatCreatedAt = (dateString) => {
    if (!dateString) return 'Ручная подача · дата —';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Ручная подача · дата —';
    const dateFormat = {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    };
    if (isDateOnlyValue(dateString) || isMidnightValue(date)) return date.toLocaleDateString('ru-RU', { ...dateFormat, timeZone: APPLICATION_TIME_ZONE });
    return formatApplicationDateTime(dateString);
  };

  const getApplicationSourceLabel = (app = {}) => {
    if (app.source === 'chat' || app.employee_login) return 'Из чата';
    if (app.source === 'employee') return 'От сотрудника';
    return 'Администратор';
  };

  const getPriorityLabel = (priority) => {
    const value = String(priority || '').trim().toLowerCase();
    if (['high', 'urgent', 'срочно', 'высокий', 'critical'].includes(value)) return 'Срочно';
    if (['low', 'низкий'].includes(value)) return 'Низкий';
    if (['medium', 'normal', 'обычный', 'средний'].includes(value)) return 'Обычный';
    return priority || 'Обычный';
  };

  const getPriorityClass = (priority) => {
    const value = String(priority || '').trim().toLowerCase();
    if (['high', 'urgent', 'срочно', 'высокий', 'critical'].includes(value)) return 'high';
    if (['low', 'низкий'].includes(value)) return 'low';
    return 'normal';
  };

  const getCategoryLabel = (category) => String(category || '').trim() || 'Без категории';

  const getStatusLabel = (app) => {
    const status = app.status || (app.fl ? 'done' : 'new');
    const meta = STATUS_META[status] || STATUS_META.new;
    return <span className={`status-badge status-${status}`}><span className="status-icon">{meta.icon}</span>{meta.label}</span>;
  };

  const getPrimaryTableAction = (app = {}) => {
    const status = app.status || (app.fl ? 'done' : 'new');
    if (isEmployeeCreatedApplication(app) && ['new', 'reopened'].includes(status)) return { label: 'Взять в работу', action: () => openAcceptModal(app) };
    return { label: 'Открыть', action: () => openApplicationPanel(app) };
  };

  const runTableAction = (event, app, action) => {
    event.stopPropagation();
    setOpenActionMenuId(null);
    action(app);
  };

  const runWorkflowAction = async (app, action, extraPayload = {}) => {
    const payload = { ...extraPayload };

    setActionBusyId(app.id);
    setWorkflowMessage('');
    try {
      const response = await authFetch(`${API_BASE_URL}/applications/${app.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось изменить статус');
      const updatedApplication = data.application;
      const assignee = user?.name || user?.username || '';
      setApplications((prev) => prev
        .map((item) => (item.id === app.id ? updatedApplication : item))
        .filter((item) => matchesDashboardFilter(item, filter, assignee)));
      setSelectedApplication((prev) => (prev?.id === app.id ? data.application : prev));
      setStats((current) => updateStatsForApplicationTransition(current, app, updatedApplication));
      setWorkflowMessage(data.message || 'Статус заявки обновлён');
      showToast(data.message || 'Статус заявки обновлён', 'success');
      setWorkflowModal(null);
      window.dispatchEvent(new CustomEvent('applications:status-changed', {
        detail: { from: getApplicationStatus(app), to: getApplicationStatus(updatedApplication) }
      }));
      fetchGeneralStats();
      fetchApplications({ silent: true });
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
    if (workflowModal?.type === 'bulk-close') return confirmBulkClose();
    if (!workflowModal?.app) return;
    if (workflowModal.type === 'accept') {
      runWorkflowAction(workflowModal.app, 'accept', {
        executor: workflowModal.values.executor,
        eta_minutes: Number(workflowModal.values.eta_minutes) || 10,
        admin_comment: workflowModal.values.admin_comment
      });
    }
  };

  const toggleSelectApplication = (event, appId) => {
    event.stopPropagation();
    setSelectedIds((current) => (
      current.includes(appId) ? current.filter((id) => id !== appId) : [...current, appId]
    ));
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = displayedApplications.map((app) => app.id);
    setSelectedIds((current) => (
      visibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]))
    ));
  };

  const runBulkAssign = async () => {
    if (!bulkExecutor.trim() || selectedIds.length === 0) return;
    setActionBusyId('bulk');
    try {
      await Promise.all(selectedIds.map((id) => authFetch(`${API_BASE_URL}/applications/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executor: bulkExecutor.trim(),
          admin_comment: 'Назначено массовым действием'
        })
      })));
      showToast(`Исполнитель назначен для ${selectedIds.length} заявок`, 'success');
      setBulkAssignOpen(false);
      setBulkExecutor('');
      setSelectedIds([]);
      fetchApplications();
      fetchGeneralStats();
    } catch (error) {
      showToast('Не удалось назначить исполнителя массово', 'error');
    } finally {
      setActionBusyId(null);
    }
  };

  const runBulkClose = async () => {
    if (selectedIds.length === 0) return;
    const selectedApplications = displayedApplications.filter((app) => selectedIds.includes(app.id));
    const eligible = selectedApplications.filter((app) => (app.status || '') === 'waiting_employee_confirmation');
    const blocked = selectedApplications.filter((app) => (app.status || '') !== 'waiting_employee_confirmation');
    if (blocked.length > 0) showToast(`Можно закрывать только заявки, ожидающие подтверждения. Исключено: ${blocked.length}.`, 'warning');
    if (eligible.length === 0) return;
    setWorkflowModal({ type: 'bulk-close', apps: eligible, blocked, values: { reason: '' } });
  };

  const confirmBulkClose = async () => {
    const apps = workflowModal?.apps || [];
    const reason = workflowModal?.values?.reason?.trim();
    if (!reason || apps.length === 0) return;
    setActionBusyId('bulk');
    try {
      const responses = await Promise.all(apps.map((app) => authFetch(`${API_BASE_URL}/applications/${app.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_comment: `Закрыто массовым действием администратора: ${reason}` })
      })));
      if (responses.some((response) => !response.ok)) throw new Error('Не все заявки удалось закрыть');
      showToast(`Закрыто заявок: ${apps.length}`, 'success');
      setSelectedIds([]);
      setWorkflowModal(null);
      fetchApplications();
      fetchGeneralStats();
    } catch (error) {
      showToast('Не удалось закрыть выбранные заявки', 'error');
    } finally {
      setActionBusyId(null);
    }
  };

  const exportSelectedApplications = async () => {
    const selectedApplications = displayedApplications.filter((app) => selectedIds.includes(app.id));
    if (selectedApplications.length === 0) return;
    try {
      const exportResponse = await authFetch(`${API_BASE_URL}/applications/export-xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applications: selectedApplications, sheetName: 'Выбранные заявки' })
      });
      if (!exportResponse.ok) throw new Error('Не удалось сформировать файл Excel');
      const blob = await exportResponse.blob();
      const fileName = `selected-applications-${new Date().toISOString().split('T')[0]}.xlsx`;
      downloadBlob(blob, fileName);
      showToast(`Экспортировано заявок: ${selectedApplications.length}`, 'success');
    } catch (error) {
      console.error('Ошибка при экспорте выбранных заявок:', error);
      showToast('Не удалось экспортировать выбранные заявки', 'error');
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
    { id: 'all', label: 'Все', value: stats.total || 0, hint: 'Все заявки' },
    { id: 'inwork', label: 'В работе', value: (stats.inwork != null ? stats.inwork : ((stats.active || 0) + (stats.confirmation || 0))), hint: 'Приняты и выполняются' },
    { id: 'queue', label: 'Новые', value: stats.queue || 0, hint: 'Новые заявки сотрудников' }
  ];

  const displayedApplications = useMemo(() => {
    const sorted = [...applications];
    sorted.sort((left, right) => {
      if (sortMode === 'sla') {
        const severity = { critical: 1, warning: 2, ok: 3 };
        const leftSla = getSlaState(left);
        const rightSla = getSlaState(right);
        const byLevel = (severity[leftSla.level] || 4) - (severity[rightSla.level] || 4);
        if (byLevel !== 0) return byLevel;
        return (rightSla.seconds || 0) - (leftSla.seconds || 0);
      }
      if (sortMode === 'status') {
        const leftStatus = left.status || (left.fl ? 'done' : 'new');
        const rightStatus = right.status || (right.fl ? 'done' : 'new');
        return (TABLE_STATUS_ORDER[leftStatus] || 99) - (TABLE_STATUS_ORDER[rightStatus] || 99);
      }
      if (sortMode === 'date_asc' || sortMode === 'date_desc') {
        const leftDate = new Date(left.created_at || left.data || 0).getTime() || 0;
        const rightDate = new Date(right.created_at || right.data || 0).getTime() || 0;
        return sortMode === 'date_asc' ? leftDate - rightDate : rightDate - leftDate;
      }
      if (sortMode === 'executor') {
        return String(left.executor || 'яяя').localeCompare(String(right.executor || 'яяя'), 'ru');
      }
      return 0;
    });
    return sorted;
  }, [applications, sortMode]);

  const selectedAppTimes = selectedApplication ? getApplicationTimes(selectedApplication, dashboardNow) : null;
  const selectedWorkCycles = Array.isArray(selectedApplication?.work_cycles) ? selectedApplication.work_cycles : [];
  const selectedCumulativeWorkSeconds = selectedApplication ? getCumulativeWorkSeconds(selectedApplication, dashboardNow) : null;

  return (
    <div className="dashboard-container">
      {/* Заголовок */}
      <div className="dashboard-header">
        <div><h1>Заявки</h1><p className="dashboard-subtitle">Очередь, сроки и действия по обращениям</p></div>
        <div className="header-tools">
          <div className="table-search table-search--header"><input type="text" value={searchTerm} onChange={(e) => handleSearch(e.target.value)} placeholder="Поиск по заявкам" className="search-input" aria-label="Поиск по заявкам" />{searchTerm && <button type="button" onClick={clearSearch} className="clear-search" title="Очистить поиск">×</button>}</div>
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
      </div>

      {/* Статистика */}
      <div className="stats-grid dashboard-stats-expanded">
        {statCards.map((card) => (
          <div
            key={card.id}
            className={`stat-card ${card.tone === 'danger' ? 'stat-danger' : ''} ${filter === card.id ? 'stat-active' : ''}`}
            onClick={() => (card.id === 'all' ? clearFilters() : setFilterAndResetPage(card.id))}
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
        <details className="dashboard-settings">
          <summary>Фильтры и настройки</summary>
          <div className="dashboard-settings-body">
        <div className="queue-filter-row" aria-label="Очереди заявок">
          {QUEUE_FILTERS.map((queue) => <button key={queue.id} type="button" className={filter === queue.id ? 'active' : ''} onClick={() => (queue.id === 'all' ? clearFilters() : setFilterAndResetPage(queue.id))}>{queue.label}</button>)}
        </div>
        <div className="saved-views-row" aria-label="Сохранённые представления">
          <strong>Представления:</strong>
          {SAVED_DASHBOARD_VIEWS.map((view) => (
            <button key={view.id} type="button" onClick={() => applySavedView(view)}>{view.label}</button>
          ))}
        </div>
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
        <div className="dashboard-view-tools">
          <details className="columns-panel">
            <summary>Колонки</summary>
            <div className="columns-panel-body">
              {DASHBOARD_COLUMNS.map((column) => (
                <label key={column.id}>
                  <input type="checkbox" checked={isColumnVisible(column.id)} onChange={() => toggleColumn(column.id)} />
                  {column.label}
                </label>
              ))}
            </div>
          </details>
          <button type="button" className={`compact-mode-toggle ${compactMode ? 'active' : ''}`} onClick={toggleCompactMode}>
            {compactMode ? 'Обычный режим' : 'Компактный режим'}
          </button>
        </div>
          </div>
        </details>
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
                {displayedApplications.length > 0 && (
                  <span className="table-count">
                    ({displayedApplications.length} из {filteredStats.total})
                  </span>
                )}
              </h3>
              <p>Поиск работает по заявке, кабинету, сотруднику, телефону и исполнителю.</p>
            </div>
            <div className="table-tools">
              <div className="view-switch" role="group" aria-label="Вид заявок"><button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => { setViewMode('table'); localStorage.setItem('dashboard.viewMode', 'table'); }}>Таблица</button><button type="button" className={viewMode === 'timeline' ? 'active' : ''} onClick={() => { setViewMode('timeline'); localStorage.setItem('dashboard.viewMode', 'timeline'); }}>По времени</button></div>
              <label className="page-size-control">
                <span>Сортировка</span>
                <select
                  value={sortMode}
                  onChange={(e) => {
                    setSortMode(e.target.value);
                    localStorage.setItem('dashboard.sortMode', e.target.value);
                    setCurrentPage(1);
                  }}
                >
                  {SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
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
            {selectedIds.length > 0 && (
              <div className="bulk-actions-bar">
                <strong>Выбрано: {selectedIds.length}</strong>
                <button type="button" onClick={() => setBulkAssignOpen(true)} disabled={actionBusyId === 'bulk'}>Назначить исполнителя</button>
                <button type="button" onClick={runBulkClose} disabled={actionBusyId === 'bulk'}>Закрыть</button>
                <button type="button" onClick={exportSelectedApplications}>Экспортировать выбранные</button>
                <button type="button" onClick={() => setSelectedIds([])}>Снять выбор</button>
                {bulkAssignOpen && (
                  <div className="bulk-assign-box">
                    <input
                      type="text"
                      value={bulkExecutor}
                      onChange={(event) => setBulkExecutor(event.target.value)}
                      placeholder="Исполнитель"
                    />
                    <button type="button" onClick={runBulkAssign} disabled={!bulkExecutor.trim() || actionBusyId === 'bulk'}>Назначить</button>
                    <button type="button" onClick={() => setBulkAssignOpen(false)}>Отмена</button>
                  </div>
                )}
              </div>
            )}
            {viewMode === 'timeline' ? <div className="request-timeline">{Object.entries(displayedApplications.reduce((groups, app) => { const key = new Date(app.created_at || app.data).toLocaleDateString('ru-RU', { timeZone: APPLICATION_TIME_ZONE }); (groups[key] ||= []).push(app); return groups; }, {})).map(([date, apps]) => <section className="timeline-day" key={date}><h4>{date}</h4><div className="timeline-row">{apps.sort((a, b) => new Date(a.created_at || a.data) - new Date(b.created_at || b.data)).map(app => (
  <button type="button" className="timeline-request" key={app.id} onClick={() => openApplicationPanel(app)}>
    <small>#{app.id} · {formatTime(app.created_at || app.data)} · {getStatusLabel(app)}</small>
    <strong>{app.name || 'Без ФИО'} · каб. {app.cabinet || '—'}</strong>
    <span className="timeline-text">{app.application || 'Без описания'}</span>
  </button>
))}</div></section>)}</div> : <div className="table-responsive">
              <table className={`applications-table ${compactMode ? 'applications-table-compact' : ''}`}>
                <thead>
                  <tr>
                    <th className="select-column"><input type="checkbox" checked={displayedApplications.length > 0 && displayedApplications.every((app) => selectedIds.includes(app.id))} onChange={toggleSelectAllVisible} aria-label="Выбрать все заявки на странице" /></th>
                    {isColumnVisible('employee') && <th>Сотрудник</th>}
                    {isColumnVisible('request') && <th>Заявка</th>}
                    {isColumnVisible('executor') && <th>Исполнитель</th>}
                    {isColumnVisible('created') && <th>Дата</th>}
                    {isColumnVisible('status') && <th>Статус</th>}
                    {isColumnVisible('actions') && <th>Действия</th>}
                  </tr>
                </thead>
                <tbody>
	                  {displayedApplications.length > 0 ? (
	                    displayedApplications.map((app) => {
                        const primaryAction = getPrimaryTableAction(app);
                        const status = app.status || (app.fl ? 'done' : 'new');
                        return (
	                      <tr
	                        key={app.id}
                        className={`${app.fl ? 'row-completed' : `row-${app.status || 'new'}`} ${selectedApplication?.id === app.id ? 'row-selected' : ''}`}
	                        onClick={() => openApplicationPanel(app)}
	                      >
	                        <td className="select-column" onClick={(event) => event.stopPropagation()}>
                            <input type="checkbox" checked={selectedIds.includes(app.id)} onChange={(event) => toggleSelectApplication(event, app.id)} aria-label={`Выбрать заявку ${app.id}`} />
                          </td>
	                        {isColumnVisible('employee') && <td className="cell-person">
	                          <strong>{app.name || 'Сотрудник'}</strong>
	                          <span>каб. {app.cabinet || '—'}{app.N_tel ? ` · ${app.N_tel}` : ''}</span>
	                        </td>}

	                        {isColumnVisible('request') && <td
	                             className="cell-application"
	                             data-tooltip={app.application}
	                             onMouseMove={(e) => {
                               document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
                               document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
                             }}
                        >
                          <div className="application-summary">
                            <strong>#{app.id || '—'} · {app.application || 'Без описания'}</strong>
                            <div className="application-badges">
                              {!isAdministratorCreatedApplication(app) && <span className="meta-badge category-badge">{getCategoryLabel(app.category)}</span>}
                              {!isAdministratorCreatedApplication(app) && <span className={`meta-badge priority-badge priority-${getPriorityClass(app.priority)}`}>{getPriorityLabel(app.priority)}</span>}
                              <span className="meta-badge source-badge">{getApplicationSourceLabel(app)}</span>
	                            </div>
	                          </div>
	                        </td>}

                        {isColumnVisible('executor') && <td className="cell-executor">
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
                        </td>}

                        {isColumnVisible('created') && <td className="cell-date cell-created">
                          <strong>{new Date(app.created_at || app.data).toLocaleDateString('ru-RU', { timeZone: APPLICATION_TIME_ZONE })}</strong>
                        </td>}
                        {isColumnVisible('status') && <td>{getStatusLabel(app)}</td>}
                        {isColumnVisible('actions') && <td className="cell-actions">
                          <div className="workflow-actions workflow-actions-compact">
                            <button
                              type="button"
                              className="primary-workflow-action"
                              disabled={actionBusyId === app.id}
                              onClick={(event) => runTableAction(event, app, () => primaryAction.action())}
                            >
                              {actionBusyId === app.id ? '...' : primaryAction.label}
                            </button>
                            <div className="row-action-menu-wrap">
                              <button
                                type="button"
                                className="row-action-menu-toggle"
                                aria-label="Дополнительные действия"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenActionMenuId(openActionMenuId === app.id ? null : app.id);
                                }}
                              >
                                ⋯
                              </button>
                              {openActionMenuId === app.id && (
                                <div className="row-action-menu" onClick={(event) => event.stopPropagation()}>
                                  <button type="button" onClick={(event) => runTableAction(event, app, openApplicationPanel)}>Открыть карточку</button>
                                  {app.employee_login && <a href={getOpenChatHref(app)}>Открыть чат</a>}
                                  {isEmployeeCreatedApplication(app) && ['new', 'reopened'].includes(status) && <button type="button" onClick={(event) => runTableAction(event, app, openAcceptModal)}>Взять в работу</button>}
                                </div>
                              )}
                            </div>
	                          </div>
                        </td>}
	                      </tr>
                        );
                      })
	                  ) : (
	                    <tr>
		                      <td colSpan={visibleColumns.length + 1} className="no-data">
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
            </div>}
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
            <p>{selectedApplication.name} · каб. {selectedApplication.cabinet || '—'} · тел: {selectedApplication.N_tel || '—'}</p>
          </div>
          <div className="time-summary-card">
            <strong>{getStatusLabel(selectedApplication)}</strong>
            {selectedAppTimes && (
              <span>
                {selectedCumulativeWorkSeconds != null && <em>Всего в работе: {formatApplicationDuration(selectedCumulativeWorkSeconds)}</em>}
                {selectedAppTimes.closedAt && selectedAppTimes.totalSeconds != null && <em>Подали → закрыли: {formatApplicationDuration(selectedAppTimes.totalSeconds)}</em>}
              </span>
            )}
          </div>
          <div className="next-action-card">
            <span>Следующее действие</span>
            <strong>{getNextAction(selectedApplication)}</strong>
            <p>{getStatusDescription(selectedApplication)}</p>
          </div>
          <div className="side-panel-section">
            <h3>Описание</h3>
            <p>{selectedApplication.application}</p>
          </div>
          <div className="side-panel-section"><h3>Хронология</h3><div className="side-panel-grid">
            {!isAdministratorCreatedApplication(selectedApplication) && <div><strong>Категория</strong><span>{selectedApplication.category || '—'}</span></div>}
            {!isAdministratorCreatedApplication(selectedApplication) && <div><strong>Приоритет</strong><span>{selectedApplication.priority || 'Обычный'}</span></div>}
            <div><strong>Источник</strong><span>{getApplicationSourceLabel(selectedApplication)}</span></div>
            <div><strong>Исполнитель</strong><span>{isAdministratorCreatedApplication(selectedApplication) ? (selectedApplication.executor || '—') : (selectedApplication.executor || selectedApplication.accepted_by || 'Не назначен')}</span></div>
            <div><strong>Подана</strong><span>{formatCreatedAt(selectedApplication.created_at || selectedApplication.data)}</span></div>
            {!isAdministratorCreatedApplication(selectedApplication) && selectedAppTimes?.takenAt ? <div><strong>Взята в работу</strong><span>{formatCreatedAt(selectedAppTimes.takenAt)}</span></div> : null}
            {selectedAppTimes?.closedAt ? <div><strong>Закрыта</strong><span>{formatCreatedAt(selectedAppTimes.closedAt)}</span></div> : null}
            {selectedAppTimes?.closedAt && selectedAppTimes.totalSeconds != null && <div><strong>Подача → закрытие</strong><span>{formatApplicationDuration(selectedAppTimes.totalSeconds)}</span></div>}
            {!isAdministratorCreatedApplication(selectedApplication) && selectedAppTimes?.waitSeconds != null && <div><strong>Подача → взятие</strong><span>{formatApplicationDuration(selectedAppTimes.waitSeconds)}</span></div>}
            {selectedCumulativeWorkSeconds != null && <div><strong>Общее время работы</strong><span>{formatApplicationDuration(selectedCumulativeWorkSeconds)}</span></div>}
            {selectedWorkCycles.map((cycle, index) => <div key={`${cycle.started_at}-${cycle.closed_at}-${index}`}><strong>{index === 0 ? 'Закрыта' : 'Повторно закрыта'}</strong><span>{formatCreatedAt(cycle.closed_at)} · {formatApplicationDuration(cycle.duration_seconds)}</span></div>)}
            {!selectedApplication.fl && selectedWorkCycles.length > 0 && selectedApplication.work_started_at && <div><strong>Повторно открыта</strong><span>{formatCreatedAt(selectedApplication.work_started_at)}</span></div>}
          </div></div>
          {selectedApplication.admin_comment && (
            <div className="side-panel-section">
              <h3>Комментарий администратора</h3>
              <p>{selectedApplication.admin_comment}</p>
            </div>
          )}
          <div className="side-panel-section">
            <h3>Что сделано</h3>
            <p>{selectedApplication.process || 'Пока не заполнено.'}</p>
          </div>
          {selectedApplication.employee_comment && (
            <div className="side-panel-section">
              <h3>Комментарий сотрудника</h3>
              <p>{selectedApplication.employee_comment}</p>
            </div>
          )}
          <div className="side-panel-actions">
            {isEmployeeCreatedApplication(selectedApplication) && ['new', 'reopened'].includes(selectedApplication.status || 'new') && <button type="button" onClick={() => openAcceptModal(selectedApplication)}>Взять в работу</button>}
            {selectedApplication.employee_login && <a href={getOpenChatHref(selectedApplication)}>Открыть чат</a>}
            <a href={`/edit/${selectedApplication.id}`}>Редактировать заявку</a>
          </div>
          <div className="side-panel-section">
            <h3>История действий</h3>
            {eventsLoading && <p>Загружаем историю…</p>}
            {!eventsLoading && applicationEvents.length === 0 && <p>История пока пустая.</p>}
            <div className="event-list">
              {applicationEvents.map((event) => (
                <div key={event.id} className="event-item">
                  <strong>{event.event_type}</strong>
                  <span>{event.actor_login || '—'} · {event.created_at ? formatApplicationDateTime(event.created_at) : '—'}</span>
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
            <h2>{workflowModal.type === 'accept' ? 'Взять заявку в работу' : workflowModal.type === 'bulk-close' ? 'Подтвердить массовое закрытие' : 'Что сделано'}</h2>
            {workflowModal.type === 'accept' ? (
              <>
                <label>Исполнитель<input value={workflowModal.values.executor} onChange={(event) => updateWorkflowModalValue('executor', event.target.value)} required /></label>
                <label>Подойдут через, минут<input type="number" min="1" value={workflowModal.values.eta_minutes} onChange={(event) => updateWorkflowModalValue('eta_minutes', event.target.value)} required /></label>
                <label>Комментарий сотруднику<textarea rows={4} value={workflowModal.values.admin_comment} onChange={(event) => updateWorkflowModalValue('admin_comment', event.target.value)} /></label>
              </>
            ) : workflowModal.type === 'bulk-close' ? (
              <>
                <p className="bulk-close-warning">Будут закрыты заявки, по которым исполнитель завершил работу.</p>
                <ul className="bulk-close-list">{workflowModal.apps.map((app) => <li key={app.id}>#{app.id} — {app.application || 'Без описания'}</li>)}</ul>
                {workflowModal.blocked?.length > 0 && <p className="bulk-close-warning">Не будут закрыты: {workflowModal.blocked.length} заявок с другим статусом.</p>}
                <label>Причина массового закрытия<textarea rows={4} value={workflowModal.values.reason} onChange={(event) => updateWorkflowModalValue('reason', event.target.value)} required placeholder="Например: подтверждено по телефону" /></label>
              </>
            ) : (
              <label>Что было сделано<textarea rows={5} value={workflowModal.values.process} onChange={(event) => updateWorkflowModalValue('process', event.target.value)} required /></label>
            )}
            <div className="modal-actions"><button type="button" onClick={() => setWorkflowModal(null)}>Отмена</button><button type="submit" disabled={actionBusyId === (workflowModal.app?.id || 'bulk')}>{actionBusyId === (workflowModal.app?.id || 'bulk') ? 'Сохраняем…' : workflowModal.type === 'bulk-close' ? 'Закрыть выбранные' : 'Сохранить'}</button></div>
          </form>
        </div>
      )}

      {toast && <div className={`dashboard-toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
};

const getStatusDescription = (app = {}) => {
  const status = app.status || (app.fl ? 'done' : 'new');
  if (isAdministratorCreatedApplication(app) && status !== 'done') {
    return 'Заявка создана администратором. Закрыть её может администратор.';
  }
  return ({
    new: 'Сотрудник подал заявку, ожидает взятия в работу.',
    reopened: 'Заявка переоткрыта сотрудником, ожидает взятия в работу.',
    accepted: 'Заявка в работе (назначена исполнителю).',
    in_progress: 'Заявка в работе. Закроет сотрудник либо администратор через редактирование.',
    waiting_employee_confirmation: 'Работа выполнена. Заявку можно закрыть сотруднику или администратору.',
    done: 'Заявка закрыта.'
  })[status] || 'Статус заявки уточняется.';
};

const getNextAction = (app = {}) => {
  const status = app.status || (app.fl ? 'done' : 'new');
  return ({
    new: 'Взять в работу',
    reopened: 'Взять в работу',
    accepted: 'В работе',
    in_progress: 'В работе',
    waiting_employee_confirmation: 'Закрыть заявку',
    done: 'Заявка закрыта'
  })[status] || 'Откройте заявку';
};

export default Dashboard;
