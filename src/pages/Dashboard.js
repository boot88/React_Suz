import AdminNotice from '../components/AdminNotice';
import { useAdminTranslation, getAdminLocale } from '../utils/adminTranslation';
import { userSettingsStorage } from '../utils/userPreferences';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './Dashboard.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { useAuth } from '../context/AuthContext';
import { authFetch, withAccessToken } from '../utils/authFetch';
import OperationProgress from '../components/OperationProgress';
import {
  APPLICATION_TIME_ZONE,
  formatApplicationDateTime,
  formatApplicationDuration,
  getApplicationTiming
} from '../utils/applicationTime';

const requestCountLabel = (count) => {
  const lastTwo = count % 100, last = count % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'заявок' : last === 1 ? 'заявка' : last >= 2 && last <= 4 ? 'заявки' : 'заявок';
  return `${count} ${word}`;
};

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
  { id: 'unassigned', label: 'Без исполнителя' },
  { id: 'done', label: 'Закрытые' },
  { id: 'overdue', label: 'Просроченные' }
];
const TABLE_STATUS_ORDER = {
  new: 1,
  reopened: 2,
  accepted: 3,
  in_progress: 4,
  waiting_employee_confirmation: 5,
  done: 6
};
const SHOW_APPLICATION_ACTION_HISTORY_KEY = 'admin.showApplicationActionHistory';
const DASHBOARD_LIMIT_KEY = 'dashboard.pageSize';
const DASHBOARD_CARD_SIZE_KEY = 'dashboard.timelineCardDesign';
const DASHBOARD_CARD_SIZE_EVENT = 'dashboard:timeline-card-design-change';
const DEFAULT_DASHBOARD_COLUMNS = ['employee', 'request', 'executor', 'created', 'status'];
const DASHBOARD_PAGE_SIZES = [5, 10, 15, 20, 50];
const readDashboardSortMode = () => (
  userSettingsStorage.getItem('dashboard.sortMode') === 'date_asc' ? 'date_asc' : 'date_desc'
);
const readDashboardPageSize = () => {
  const stored = Number(userSettingsStorage.getItem(DASHBOARD_LIMIT_KEY));
  return DASHBOARD_PAGE_SIZES.includes(stored) ? stored : 10;
};
const readDashboardCardDesign = () => (
  userSettingsStorage.getItem(DASHBOARD_CARD_SIZE_KEY) === 'modern' ? 'modern' : 'legacy'
);
// Три ключевых времени заявки и производные длительности.
const getApplicationTimes = (app = {}, now = Date.now()) => {
  const timing = getApplicationTiming(app, now);
  return {
    ...timing,
    waitSeconds: timing.waitingSeconds
  };
};

const getCumulativeWorkSeconds = (app = {}, now = Date.now()) => getApplicationTiming(app, now).cumulativeWorkSeconds;
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
const normalizeEmployeeLookupValue = (value = '') => String(value)
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^а-яa-z0-9]/g, '');

const getPersonNameTokens = (value = '') => String(value)
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[^а-яa-z]+/g, ' ')
  .trim()
  .split(/\s+/)
  .filter(Boolean);

const getPersonMatchKeys = (value = '') => {
  const tokens = getPersonNameTokens(value);
  if (tokens.length === 0) return [];
  const keys = new Set([`full:${tokens.join('')}`, `surname:${tokens[0]}`]);
  const addShortKey = (surname, otherNames) => {
    const initials = otherNames.map((part) => part[0]).filter(Boolean).join('');
    if (surname && initials) keys.add(`short:${surname}:${initials}`);
  };
  addShortKey(tokens[0], tokens.slice(1));
  if (tokens.length >= 3) addShortKey(tokens[tokens.length - 1], tokens.slice(0, -1));
  return [...keys];
};

const joinDirectoryValues = (records, fields) => {
  const values = [];
  records.forEach((record) => fields.forEach((field) => {
    String(record?.[field] || '')
      .split(/\s*;\s*/)
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => {
        const normalized = value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
        if (!values.some((existing) => existing.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ') === normalized)) values.push(value);
      });
  }));
  return values.join('; ');
};

const getDirectoryValueWithFallback = (activeRecords, historicalRecords, fields) => (
  joinDirectoryValues(activeRecords, fields) || joinDirectoryValues(historicalRecords, fields)
);

const mergeEmployeeDirectoryEntries = (items = []) => {
  const groups = new Map();
  (Array.isArray(items) ? items : []).forEach((employee) => {
    const key = normalizeEmployeeLookupValue(employee?.full_name);
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), employee]);
  });

  return [...groups.values()].map((records) => {
    const activeRecords = records.filter((record) => record.is_active == null || Number(record.is_active) === 1);
    const historicalRecords = records.filter((record) => !activeRecords.includes(record));
    const preferredRecords = activeRecords.length > 0 ? activeRecords : historicalRecords;
    const primary = preferredRecords[0] || records[0] || {};
    const email = getDirectoryValueWithFallback(activeRecords, historicalRecords, ['email'])
      || (String(primary.login || '').includes('@') ? primary.login : '');
    const internalPhone = getDirectoryValueWithFallback(activeRecords, historicalRecords, ['internal_phone', 'phone']);
    return {
      ...primary,
      full_name: String(primary.full_name || '').replace(/\s+/g, ' ').trim(),
      position: getDirectoryValueWithFallback(activeRecords, historicalRecords, ['position']),
      department: getDirectoryValueWithFallback(activeRecords, historicalRecords, ['department']),
      room: getDirectoryValueWithFallback(activeRecords, historicalRecords, ['room']),
      internal_phone: internalPhone,
      phone: internalPhone,
      external_phone: getDirectoryValueWithFallback(activeRecords, historicalRecords, ['external_phone']),
      email,
      is_active: activeRecords.length > 0
    };
  });
};

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

// Раздел списка («Новые» / «В работе» / «Выполненные»), в котором находится заявка.
const dashboardFilterForApplication = (app = {}) => {
  const status = getApplicationStatus(app);
  if (status === 'done') return 'done';
  if (['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(status)) return 'inwork';
  return 'queue';
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
  // SLA applies to the current work cycle, independently of cumulative work.
  return secondsSince(app.work_started_at || app.accepted_at || app.start_data || app.created_at || app.data);
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

const readDashboardSession = () => {
  try {
    const username = JSON.parse(localStorage.getItem('authState') || 'null')?.user?.username || '';
    return JSON.parse(sessionStorage.getItem(`dashboard:${username}`) || '{}');
  } catch { return {}; }
};

const Dashboard = () => {
  const t = useAdminTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [applications, setApplications] = useState([]);
  const [employeeDirectory, setEmployeeDirectory] = useState([]);
  const savedSession = useRef(readDashboardSession());
  const [currentPage, setCurrentPage] = useState(() => savedSession.current.currentPage || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit, setLimit] = useState(readDashboardPageSize);
  const [loading, setLoading] = useState(true);
  const [applicationsLoadError, setApplicationsLoadError] = useState(null);
  const [hasLoadedApplications, setHasLoadedApplications] = useState(false);
  const hasLoadedApplicationsRef = useRef(false);
  const [filter, setFilter] = useState(() => savedSession.current.filter || 'all');
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
  const [searchTerm, setSearchTerm] = useState(() => savedSession.current.searchTerm || '');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(() => savedSession.current.searchTerm || '');
  const applicationsAbortRef = useRef(null);
  const searchMountedRef = useRef(false);
  const [searchRevision, setSearchRevision] = useState(0);
  useEffect(() => {
    if (!searchMountedRef.current) { searchMountedRef.current = true; return undefined; }
    // Invalidate immediately; an old response must not paint while typing.
    applicationsAbortRef.current?.abort();
    applicationsRequestIdRef.current += 1;
    applicationsRequestUrlRef.current = '';
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setSearchRevision((value) => value + 1);
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);
  const [workflowMessage, setWorkflowMessage] = useState('');
  const [workflowMessageType, setWorkflowMessageType] = useState('info');
  const [actionBusyId, setActionBusyId] = useState(null);
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [sortMode, setSortMode] = useState(readDashboardSortMode);
  const visibleColumns = DEFAULT_DASHBOARD_COLUMNS;
  const compactMode = false;
  const [viewMode, setViewMode] = useState(() => userSettingsStorage.getItem('dashboard.viewMode') || 'timeline');
  const [timelineCardDesign, setTimelineCardDesign] = useState(readDashboardCardDesign);
  const [selectedIds, setSelectedIds] = useState([]);
  const bulkCloseLockRef = useRef(false);
  const [bulkCloseResult, setBulkCloseResult] = useState(null);
  const [bulkAssignResult, setBulkAssignResult] = useState(null);
  const bulkFailedIdsRef = useRef([]);
  const bulkAssignLockRef = useRef(false);
  const [exportProgress, setExportProgress] = useState(null);
  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => applications.some((app) => app.id === id) || bulkFailedIdsRef.current.includes(id)));
  }, [applications]);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkExecutor, setBulkExecutor] = useState('');
  const [selectedApplication, setSelectedApplication] = useState(null);
  const [applicationEvents, setApplicationEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showApplicationActionHistory, setShowApplicationActionHistory] = useState(() => userSettingsStorage.getItem(SHOW_APPLICATION_ACTION_HISTORY_KEY) === 'true');
  const [workflowModal, setWorkflowModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [dashboardNow, setDashboardNow] = useState(Date.now());
  const applicationsRequestIdRef = useRef(0);
  const applicationsRequestUrlRef = useRef('');
  const openedApplicationFromQueryRef = useRef('');
  // ID заявки, к которой нужно прокрутить список (приходят по ссылке из статистики).
  const [scrollToApplicationId, setScrollToApplicationId] = useState(null);
  const scrollTargetRef = useRef('');

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

  const [fromDate, setFromDate] = useState(() => savedSession.current.fromDate || '');
  const [toDate, setToDate] = useState(() => savedSession.current.toDate || '');
  const [dateFilterActive, setDateFilterActive] = useState(() => Boolean(savedSession.current.dateFilterActive));
  const [appliedDates, setAppliedDates] = useState(() => savedSession.current.appliedDates || { from: '', to: '' });
  useEffect(() => {
    try {
      const key = `dashboard:${user?.username || ''}`;
      const old = JSON.parse(sessionStorage.getItem(key) || '{}');
      sessionStorage.setItem(key, JSON.stringify({ ...old, currentPage, filter, searchTerm, fromDate, toDate, dateFilterActive, appliedDates }));
    } catch {}
  }, [user?.username, currentPage, filter, searchTerm, fromDate, toDate, dateFilterActive, appliedDates]);
  const restoredScroll = useRef(false);
  const sessionStateRef = useRef({});
  sessionStateRef.current = { currentPage, filter, searchTerm, fromDate, toDate, dateFilterActive, appliedDates };
  useEffect(() => {
    const save = () => {
      try {
        const container = document.querySelector('.app-content');
        sessionStorage.setItem(`dashboard:${user?.username || ''}`, JSON.stringify({ ...sessionStateRef.current, scrollTop: container?.scrollTop || window.scrollY || 0 }));
      } catch {}
    };
    window.addEventListener('scroll', save, true);
    return () => { save(); window.removeEventListener('scroll', save, true); };
  }, [user?.username]);
  useEffect(() => {
    if (!hasLoadedApplications || restoredScroll.current) return;
    restoredScroll.current = true;
    const container = document.querySelector('.app-content');
    if (container) container.scrollTop = savedSession.current.scrollTop || 0;
    else if (savedSession.current.scrollTop > 0) window.scrollTo?.(0, savedSession.current.scrollTop);
  }, [hasLoadedApplications]);

  useEffect(() => {
    const syncApplicationActionHistoryVisibility = () => {
      const visible = userSettingsStorage.getItem(SHOW_APPLICATION_ACTION_HISTORY_KEY) === 'true';
      setShowApplicationActionHistory(visible);
      if (!visible) {
        setApplicationEvents([]);
        setEventsLoading(false);
      }
    };
    window.addEventListener('admin:application-action-history-visibility', syncApplicationActionHistoryVisibility);
    return () => window.removeEventListener('admin:application-action-history-visibility', syncApplicationActionHistoryVisibility);
  }, []);

  useEffect(() => {
    let active = true;
    const loadEmployeeDirectory = async () => {
      try {
        let response = await authFetch(`${API_BASE_URL}/employees/all`);
        let data = await response.json().catch(() => ({}));
        // Совместимость при поэтапном обновлении клиента и сервера.
        if (!response.ok) {
          response = await authFetch(`${API_BASE_URL}/auth/employees`);
          data = await response.json().catch(() => ({}));
        }
        if (!response.ok) throw new Error(data.message || data.error || 'Не удалось загрузить справочник сотрудников');
        if (active) setEmployeeDirectory(mergeEmployeeDirectoryEntries(data.employees));
      } catch (error) {
        console.error('Ошибка загрузки справочника для карточек заявок:', error);
      }
    };
    loadEmployeeDirectory();
    window.addEventListener('employee-directory-updated', loadEmployeeDirectory);
    return () => {
      active = false;
      window.removeEventListener('employee-directory-updated', loadEmployeeDirectory);
    };
  }, []);

  const exportToExcel = async () => {
    if (exportLoading || loading || searchTerm !== debouncedSearchTerm) return;
    setExportLoading(true);
    setExportProgress({ step: 0 });
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
      if (dateFilterActive && appliedDates.from) params.set('from', appliedDates.from);
      if (dateFilterActive && appliedDates.to) params.set('to', appliedDates.to);
      if (searchTerm && searchTerm.trim()) params.set('search', searchTerm.trim());


      setExportProgress({ step: 1 });
      params.set('sort', sortMode);
      const response = await authFetch(`${API_BASE_URL}/applications/export-xlsx?${params}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось сформировать файл Excel');
      }
      const blob = await response.blob();
      const fileName = `заявки_${new Date().toISOString().slice(0, 10)}.xlsx`;
      setExportProgress({ step: 2 });
      downloadBlob(blob, fileName);
      setExportProgress({ step: 3 });
      showToast(`Данные экспортированы: ${fileName}`, 'success');

    } catch (error) {
      console.error('Ошибка при экспорте:', error);
      setExportProgress({ step: 1, failed: true });
      showToast(error.message || 'Произошла ошибка при экспорте данных', 'error');
    } finally {
      setExportLoading(false);
    }
  };

  const fetchGeneralStats = async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/applications/stats`);
      if (!response.ok) throw new Error('Ошибка загрузки статистики');
      const data = await response.json();
      setStats(data.stats || { total: 0, completed: 0, pending: 0 });
      return true;
    } catch (error) {
      console.error('Ошибка загрузки статистики:', error);
      return false;
    }
  };

  const pendingRefreshRef = useRef(false);
  const fetchApplications = async ({ silent = false, attempt = 0 } = {}) => {
    if (searchTerm !== debouncedSearchTerm) return false;
    let url = `/applications?page=${currentPage}&limit=${limit}`;

    if (debouncedSearchTerm.trim()) {
      url += `&search=${encodeURIComponent(debouncedSearchTerm.trim())}`;
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
      if (appliedDates.from) url += `&from=${appliedDates.from}`;
      if (appliedDates.to) url += `&to=${appliedDates.to}`;
    }

    // При входе и восстановлении вкладки браузер может почти одновременно
    // запустить effect и событие focus. Не создаём второй одинаковый запрос:
    // его более поздняя ошибка не должна затирать успешный первый ответ.
    if (applicationsRequestUrlRef.current === url) { if (silent) pendingRefreshRef.current = true; return false; }

    applicationsAbortRef.current?.abort();
    const controller = new AbortController();
    applicationsAbortRef.current = controller;
    const requestId = applicationsRequestIdRef.current + 1;
    applicationsRequestIdRef.current = requestId;
    applicationsRequestUrlRef.current = url;
    if (!silent) {
      setLoading(true);
    }
    try {

      const response = await authFetch(`${API_BASE_URL}${url}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) {
        const requestError = new Error(data.error || 'Ошибка загрузки заявок');
        requestError.status = response.status;
        throw requestError;
      }
      if (controller.signal.aborted || requestId !== applicationsRequestIdRef.current) return false;

      if (!Array.isArray(data.applications)) throw new Error('Некорректный ответ сервера');
      hasLoadedApplicationsRef.current = true;
      setHasLoadedApplications(true);
      setApplicationsLoadError(null);
      const nextStats = data.stats || { total: 0, completed: 0, pending: 0 };
      const nextApplications = data.applications || [];
      setApplications(nextApplications);
      setTotalPages(data.totalPages || 1);
      if (data.currentPage && data.currentPage !== currentPage) setCurrentPage(data.currentPage);
      setFilteredStats(nextStats);
      if (!debouncedSearchTerm.trim() && !dateFilterActive && filter === 'all') {
        setStats(nextStats);
      } else {
        fetchGeneralStats();
      }
      window.dispatchEvent(new Event('applications:refresh'));
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== applicationsRequestIdRef.current) return false;
      console.error('Ошибка загрузки:', error);
      const retryable = !error?.status || error.status === 429 || error.status >= 500;
      if (retryable && attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
        if (controller.signal.aborted || requestId !== applicationsRequestIdRef.current) return false;
        applicationsRequestUrlRef.current = '';
        return fetchApplications({ silent, attempt: attempt + 1 });
      }
      setApplicationsLoadError(hasLoadedApplicationsRef.current ? 'Данные не обновлены. Показаны ранее загруженные данные.' : 'Не удалось загрузить заявки.');
      return false;
    } finally {
      // Подтверждение удаления может вызвать фоновую загрузку и отменить
      // предыдущий обычный запрос. В любом случае последний запрос должен
      // снять общий индикатор, иначе экран остаётся на «Загрузка данных…».
      if (applicationsRequestUrlRef.current === url) {
        applicationsRequestUrlRef.current = '';
      }
      if (requestId === applicationsRequestIdRef.current) {
        setLoading(false);
        if (pendingRefreshRef.current) { pendingRefreshRef.current = false; window.setTimeout(() => refreshRef.current?.(), 0); }
      }
    }
  };

  const handleSearch = (value) => {
    setSelectedIds([]);
    setSearchTerm(value);
  };

  const clearSearch = () => {
    setSelectedIds([]);
    setSearchTerm('');
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

  const eventsRequestRef = useRef(0);
  const fetchApplicationEvents = async (applicationId) => {
    const version = ++eventsRequestRef.current;
    if (!applicationId) return;
    setEventsLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/applications/${applicationId}/events`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить историю');
      if (version !== eventsRequestRef.current) return;
      setApplicationEvents(Array.isArray(data.events) ? data.events : []);
    } catch (error) {
      if (version !== eventsRequestRef.current) return;
      showToast(error.message || 'Не удалось загрузить историю заявки', 'error');
      setApplicationEvents([]);
    } finally {
      if (version === eventsRequestRef.current) setEventsLoading(false);
    }
  };

  const openApplicationPanel = async (app) => {
    eventsRequestRef.current += 1;
    setApplicationEvents([]);
    setSelectedApplication(app);
    if (showApplicationActionHistory) await fetchApplicationEvents(app.id);
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

  // Определяет номер страницы списка, на которой окажется заявка в выбранном
  // разделе при текущей сортировке. Нужен, чтобы после перехода из статистики
  // заявка была видна, а не оставалась на другой странице пагинации.
  const resolveApplicationPage = async (app, targetFilter) => {
    const params = new URLSearchParams({ limit: String(limit), sort: sortMode, status: targetFilter });
    const response = await authFetch(`${API_BASE_URL}/applications/${app.id}/position?${params}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось определить страницу заявки');
    return data.page || 1;
  };

  useEffect(() => {
    const applicationId = new URLSearchParams(location.search).get('application');
    if (!applicationId || openedApplicationFromQueryRef.current === applicationId) return undefined;

    let active = true;
    const openLinkedApplication = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Не удалось открыть заявку');
        if (!active || !data.application) return;
        openedApplicationFromQueryRef.current = applicationId;

        // Переходим в тот раздел списка, где находится заявка, и на ту страницу,
        // где она реально отображается. Поиск и период сбрасываем, иначе заявка
        // может остаться за пределами выборки.
        const targetFilter = dashboardFilterForApplication(data.application);
        const targetPage = await resolveApplicationPage(data.application, targetFilter);
        if (!active) return;
        const needsReload = filter !== targetFilter
          || currentPage !== targetPage
          || Boolean(searchTerm.trim())
          || dateFilterActive;
        setSearchTerm('');
        setFromDate('');
        setToDate('');
        setDateFilterActive(false);
        setAppliedDates({ from: '', to: '' });
        setFilter(targetFilter);
        setCurrentPage(targetPage);
        setScrollToApplicationId(data.application.id);
        if (needsReload) {
          setLoading(true);
        }
        await openApplicationPanel(data.application);
      } catch (queryError) {
        if (active) showToast(queryError.message || 'Не удалось открыть заявку', 'error');
      }
    };

    openLinkedApplication();
    return () => { active = false; };
    // openApplicationPanel использует актуальные настройки карточки; повторно
    // открываем её только при изменении ID в адресной строке.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Прокручиваем список к заявке, к которой перешли из статистики. Подсветка
  // здесь не нужна: она привязана к открытой карточке заявки.
  useEffect(() => {
    if (scrollToApplicationId == null) return undefined;
    const scrollTimer = window.setTimeout(() => {
      if (scrollTargetRef.current === String(scrollToApplicationId)) return;
      const node = document.querySelector(`[data-application-id="${scrollToApplicationId}"]`);
      if (!node) return;
      scrollTargetRef.current = String(scrollToApplicationId);
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    const clearTimer = window.setTimeout(() => {
      scrollTargetRef.current = '';
      setScrollToApplicationId(null);
    }, 8000);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [scrollToApplicationId, applications]);

  const closeApplicationPanel = () => {
    eventsRequestRef.current += 1;
    setSelectedApplication(null);
    setApplicationEvents([]);
    const params = new URLSearchParams(location.search);
    if (params.has('application')) {
      params.delete('application');
      openedApplicationFromQueryRef.current = '';
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : '' }, { replace: true });
    }
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
    fetchApplications();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, limit, filter, appliedDates, dateFilterActive, debouncedSearchTerm, searchRevision, sortMode]);

  useEffect(() => {
    const syncTimelineCardDesign = () => setTimelineCardDesign(readDashboardCardDesign());
    window.addEventListener(DASHBOARD_CARD_SIZE_EVENT, syncTimelineCardDesign);
    return () => window.removeEventListener(DASHBOARD_CARD_SIZE_EVENT, syncTimelineCardDesign);
  }, []);

  useEffect(() => () => {
    applicationsAbortRef.current?.abort();
    applicationsRequestIdRef.current += 1;
    applicationsRequestUrlRef.current = '';
  }, []);

  useEffect(() => {
    if (!selectedApplication || getApplicationStatus(selectedApplication) === 'done') return undefined;
    setDashboardNow(Date.now());
    const timer = window.setInterval(() => setDashboardNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [selectedApplication]);

  // Фоновое обновление списка также обновляет уже открытую карточку.
  useEffect(() => {
    setSelectedApplication((current) => {
      if (!current) return current;
      const next = applications.find((application) => application.id === current.id);
      return next && Number(next.revision || 0) >= Number(current.revision || 0) ? next : current;
    });
  }, [applications]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        // Сохраняем текущую таблицу на экране: обновление после возврата во
        // вкладку не должно заменять её индикатором загрузки.
        fetchApplications({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, limit, filter, appliedDates, dateFilterActive, debouncedSearchTerm, searchRevision, sortMode]);

  const refreshRef = useRef(null);
  refreshRef.current = () => fetchApplications({ silent: true });
  const panelRef = useRef(null);
  panelRef.current = selectedApplication;
  useEffect(() => {
    if (!user?.accessToken || typeof EventSource === 'undefined') return undefined;
    let timer, fallback;
    let active = true;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!document.hidden) refreshRef.current?.(); }, 200);
    };
    const stream = new EventSource(withAccessToken(`${API_BASE_URL}/applications/stream`));
    stream.addEventListener('ready', () => { window.clearInterval(fallback); fallback = null; refresh(); });
    stream.addEventListener('application', (event) => {
      try {
        const { application, eventType } = JSON.parse(event.data);
        if (String(panelRef.current?.id) === String(application?.id)) {
          if (eventType === 'deleted') closePanelRef.current?.();
          else setSelectedApplication((current) => current && Number(application.revision || 0) >= Number(current.revision || 0) ? { ...current, ...application } : current);
        }
        refresh();
      } catch {}
    });
    stream.addEventListener('maintenance', (event) => {
      try { window.dispatchEvent(new CustomEvent('admin:maintenance', { detail: JSON.parse(event.data) })); } catch {}
    });
    stream.onerror = () => { if (!fallback) fallback = window.setInterval(refresh, 30000); };
    const afterRestore = async () => {
      refresh();
      const applicationId = panelRef.current?.id;
      if (!applicationId) return;
      try {
        const response = await authFetch(`${API_BASE_URL}/applications/${applicationId}`);
        const data = await response.json().catch(() => ({}));
        if (!active || String(panelRef.current?.id) !== String(applicationId)) return;
        if (response.status === 404) closePanelRef.current?.();
        else if (response.ok && data.application) setSelectedApplication(data.application);
      } catch {}
    };
    window.addEventListener('admin:data-restored', afterRestore);
    return () => { active = false; stream.close(); window.clearTimeout(timer); window.clearInterval(fallback); window.removeEventListener('admin:data-restored', afterRestore); };
  }, [user?.accessToken]);
  const closePanelRef = useRef(null);
  closePanelRef.current = closeApplicationPanel;

  const setFilterAndResetPage = (newFilter) => {
    setFilter(newFilter);
    setCurrentPage(1);
    if (newFilter === filter && currentPage === 1) fetchApplications({ silent: true });
  };

  const applyFilters = () => {
    setCurrentPage(1);
    setAppliedDates({ from: fromDate, to: toDate });
    setDateFilterActive(Boolean(fromDate || toDate));
  };

  const clearFilters = () => {
    setFilter('all');
    setFromDate('');
    setToDate('');
    setCurrentPage(1);
    setDateFilterActive(false);
    setAppliedDates({ from: '', to: '' });
    setSearchTerm('');
  };

  const isColumnVisible = (columnId) => visibleColumns.includes(columnId);

  const changeSortMode = (nextSortMode) => {
    const safeSortMode = nextSortMode === 'date_asc' ? 'date_asc' : 'date_desc';
    userSettingsStorage.setItem('dashboard.sortMode', safeSortMode);
    setSortMode(safeSortMode);
    setCurrentPage(1);
  };

  const activeFilterChips = [
    filter !== 'all' ? { key: 'status', label: WORKFLOW_FILTERS.find((item) => item.id === filter)?.label || 'Раздел', onRemove: () => setFilterAndResetPage('all') } : null,
    dateFilterActive && appliedDates.from ? { key: 'from', label: `с ${appliedDates.from}`, onRemove: () => { setFromDate(''); setAppliedDates((dates) => ({ ...dates, from: '' })); setDateFilterActive(Boolean(appliedDates.to)); setCurrentPage(1); } } : null,
    dateFilterActive && appliedDates.to ? { key: 'to', label: `по ${appliedDates.to}`, onRemove: () => { setToDate(''); setAppliedDates((dates) => ({ ...dates, to: '' })); setDateFilterActive(Boolean(appliedDates.from)); setCurrentPage(1); } } : null,
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
    return new Date(dateString).toLocaleTimeString(getAdminLocale(), { timeZone: APPLICATION_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isDateOnlyValue = (dateString) => typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString.trim());
  const formatCreatedAt = (dateString) => {
    if (!dateString) return 'Ручная подача · дата —';
    if (formatApplicationDateTime(dateString, getAdminLocale()) === '—') return 'Ручная подача · дата —';
    const dateFormat = {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    };
    if (isDateOnlyValue(dateString)) return new Date(`${dateString}T00:00:00Z`).toLocaleDateString(getAdminLocale(), { ...dateFormat, timeZone: APPLICATION_TIME_ZONE });
    return formatApplicationDateTime(dateString, getAdminLocale());
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
    return <span className={`status-badge status-${status}`}><span className="status-icon">{t(meta.icon)}</span>{t(meta.label)}</span>;
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

  const deleteSelectedApplication = async () => {
    const app = selectedApplication;
    if (!app || !window.confirm(t(`Удалить заявку #${app.id}? Она исчезнет из рабочего списка.`))) return;

    setActionBusyId(app.id);
    try {
      const response = await authFetch(`${API_BASE_URL}/applications/${app.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось удалить заявку');

      setApplications((prev) => prev.filter((item) => item.id !== app.id));
      closeApplicationPanel();
      showToast(data.message || 'Заявка удалена', 'success');
      fetchApplications({ silent: true });
    } catch (error) {
      showToast(error.message || 'Не удалось удалить заявку', 'error');
    } finally {
      setActionBusyId(null);
    }
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
      setWorkflowMessageType('success');
      setWorkflowMessage(data.message || 'Статус заявки обновлён');
      showToast(data.message || 'Статус заявки обновлён', 'success');
      setWorkflowModal(null);
      window.dispatchEvent(new CustomEvent('applications:status-changed', {
        detail: { from: getApplicationStatus(app), to: getApplicationStatus(updatedApplication) }
      }));
      fetchApplications({ silent: true });
      if (showApplicationActionHistory) fetchApplicationEvents(app.id);
    } catch (error) {
      setWorkflowMessageType('error');
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

  const runBulkAssign = async (requestedIds) => {
    const ids = Array.isArray(requestedIds) ? requestedIds : selectedIds;
    if (!bulkExecutor.trim() || ids.length === 0 || bulkAssignLockRef.current) return;
    bulkAssignLockRef.current = true;
    setActionBusyId('bulk');
    try {
      const responses = await Promise.allSettled(ids.map(async (id) => {
        const response = await authFetch(`${API_BASE_URL}/applications/${id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ executor: bulkExecutor.trim(), admin_comment: 'Назначено массовым действием' })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }));
      const failedIds = ids.filter((id, index) => responses[index].status === 'rejected');
      const succeeded = ids.length - failedIds.length;
      bulkFailedIdsRef.current = failedIds;
      setBulkAssignResult({ succeeded, failedIds });
      setSelectedIds(failedIds);
      if (failedIds.length === 0) {
        setBulkAssignOpen(false);
        setBulkExecutor('');
      }
      if (succeeded > 0) {
        await fetchApplications({ silent: true });
      }
    } finally {
      bulkAssignLockRef.current = false;
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
    if (!reason || !apps.length || bulkCloseLockRef.current) return;
    bulkCloseLockRef.current = true; setActionBusyId('bulk');
    try {
      const results = await Promise.allSettled(apps.map(async (app) => {
        const response = await authFetch(`${API_BASE_URL}/applications/${app.id}/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employee_comment: `Закрыто массовым действием администратора: ${reason}` })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }));
      const failed = apps.filter((_, index) => results[index].status === 'rejected');
      const succeeded = apps.length - failed.length;
      bulkFailedIdsRef.current = failed.map((app) => app.id);
      setSelectedIds(bulkFailedIdsRef.current);
      setBulkCloseResult({ succeeded, failedIds: bulkFailedIdsRef.current });
      setWorkflowModal(failed.length ? (current) => ({ ...current, apps: failed, blocked: [] }) : null);
      await fetchApplications({ silent: true });
    } finally { bulkCloseLockRef.current = false; setActionBusyId(null); }
  };

  const exportSelectedApplications = async () => {
    const selectedApplications = displayedApplications.filter((app) => selectedIds.includes(app.id));
    if (selectedApplications.length === 0 || exportLoading) return;
    setExportLoading(true);
    setExportProgress({ step: 1 });
    try {
      const params = new URLSearchParams({ ids: selectedApplications.map((app) => app.id).join(','), sort: sortMode });
      const response = await authFetch(`${API_BASE_URL}/applications/export-xlsx?${params}`);
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Не удалось сформировать файл Excel'); }
      const blob = await response.blob();
      setExportProgress({ step: 2 });
      const fileName = `selected-applications-${new Date().toISOString().split('T')[0]}.xlsx`;
      downloadBlob(blob, fileName);
      setExportProgress({ step: 3 });
      showToast(`Экспортировано заявок: ${selectedApplications.length}`, 'success');
    } catch (error) {
      console.error('Ошибка при экспорте выбранных заявок:', error);
      setExportProgress({ step: 1, failed: true });
      showToast('Не удалось экспортировать выбранные заявки', 'error');
    } finally { setExportLoading(false); }
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    return (
      <div className="pagination">
        <button
          onClick={goToFirstPage}
          disabled={currentPage === 1}
          className="pagination-btn"
          title={t("Первая страница")}
        >
          ««
        </button>

        <button
          onClick={goToPrevPage}
          disabled={currentPage === 1}
          className="pagination-btn"
          title={t("Предыдущая страница")}
        >
          «
        </button>

        {getVisiblePages().map((page) => (
          <button
            key={page}
            onClick={() => goToPage(page)}
            className={`pagination-btn ${currentPage === page ? 'active' : ''}`}
          >
            {t(page)}
          </button>
        ))}

        <button
          onClick={goToNextPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title={t("Следующая страница")}
        >
          »
        </button>

        <button
          onClick={goToLastPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title={t("Последняя страница")}
        >
          »»
        </button>

        <span className="pagination-info">{t("Страница ")}{t(currentPage)}{t(" из ")}{t(totalPages)}
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
  const employeesByIdentifier = useMemo(() => {
    const index = new Map();
    employeeDirectory.forEach((employee) => {
      [employee.login, employee.email].forEach((identifier) => {
        const key = String(identifier || '').trim().toLowerCase();
        if (key) index.set(key, employee);
      });
    });
    return index;
  }, [employeeDirectory]);
  const employeesByName = useMemo(() => {
    const index = new Map();
    employeeDirectory.forEach((employee) => {
      getPersonMatchKeys(employee.full_name).forEach((key) => {
        if (!index.has(key)) {
          index.set(key, employee);
          return;
        }
        const existing = index.get(key);
        if (existing && normalizeEmployeeLookupValue(existing.full_name) !== normalizeEmployeeLookupValue(employee.full_name)) {
          // Не связываем заявку автоматически, если сокращённое ФИО неоднозначно.
          index.set(key, null);
        }
      });
    });
    return index;
  }, [employeeDirectory]);
  const getApplicationEmployee = (app = {}) => {
    if (app.employee_directory?.full_name) return app.employee_directory;
    const identifierMatch = employeesByIdentifier.get(String(app.employee_login || '').trim().toLowerCase());
    if (identifierMatch) return identifierMatch;
    const matchKey = getPersonMatchKeys(app.name).find((key) => employeesByName.get(key));
    return matchKey ? employeesByName.get(matchKey) : null;
  };
  const selectedEmployee = selectedApplication ? getApplicationEmployee(selectedApplication) : null;
  const selectedWorkCycles = Array.isArray(selectedApplication?.work_cycles) ? selectedApplication.work_cycles : [];
  const selectedCumulativeWorkSeconds = selectedApplication ? getCumulativeWorkSeconds(selectedApplication, dashboardNow) : null;
  // Полный срок заявки всегда идёт от первой подачи до окончательного
  // закрытия — даже если сотрудник возвращал её в работу несколько раз.
  const selectedClosureSeconds = selectedAppTimes?.closedAt
    ? selectedAppTimes.totalSeconds
    : null;

  // Рыжая подсветка в списке и ленте показывает заявку, карточка которой открыта.
  const openApplicationId = selectedApplication?.id ?? null;

  return (
    <div className="dashboard-container">
      {/* Заголовок */}
      <div className="dashboard-header">
        <div><h1>{t("Заявки")}</h1><p className="dashboard-subtitle">{t("Очередь, сроки и действия по обращениям")}</p></div>
        <div className="header-tools">
          <div className="table-search table-search--header"><input type="text" value={searchTerm} onChange={(e) => handleSearch(e.target.value)} placeholder={t("Поиск по заявкам")} className="search-input" aria-label={t("Поиск по заявкам")} />{searchTerm && <button type="button" onClick={clearSearch} className="clear-search" title={t("Очистить поиск")}>×</button>}</div>
        <button
          onClick={exportToExcel}
          disabled={exportLoading || loading || filteredStats.total === 0 || filteredStats.total > 100000}
          className="export-btn"
          title={t("Экспорт всех найденных заявок с учётом поиска и применённого периода. Максимум 100 000 заявок.")}
        >
          {exportLoading ? (
            <>
              <span className="button-spinner"></span>{t("Экспорт...")}</>
          ) : (
            <>
              <span className="export-icon">📥</span>{t("Экспорт в Excel")}</>
          )}
        </button>
        </div>
      </div>

      {filteredStats.total > 100000 && <AdminNotice type="warning">{t('Экспорт ограничен 100 000 заявок. Выберите меньший период.')}</AdminNotice>}
      {/* Статистика */}
      <div className="stats-grid dashboard-stats-expanded">
        {statCards.map((card) => (
          <button
            type="button"
            aria-pressed={filter === card.id}
            key={card.id}
            className={`stat-card ${card.tone === 'danger' ? 'stat-danger' : ''} ${filter === card.id ? 'stat-active' : ''}`}
            onClick={() => (card.id === 'all' ? clearFilters() : setFilterAndResetPage(card.id))}
          >
            <span className="stat-label">{t(card.label)}</span>
            <span className="stat-number">{card.value}</span>
            <small>{t(card.hint)}</small>
          </button>
        ))}
      </div>

      {exportProgress && <OperationProgress steps={['Подготовка', 'Обработка данных', 'Сохранение', 'Готово']} {...exportProgress} />}

      {workflowMessage && <AdminNotice type={workflowMessageType}>{t(workflowMessage)}</AdminNotice>}

      {applicationsLoadError && <AdminNotice type={hasLoadedApplications ? "warning" : "error"} className="applications-load-error">
        {t(applicationsLoadError)} <button type="button" disabled={loading || searchTerm !== debouncedSearchTerm} onClick={() => fetchApplications({ silent: hasLoadedApplications })}>{t("Повторить загрузку")}</button>
      </AdminNotice>}
      {bulkCloseResult && <AdminNotice type={bulkCloseResult.failedIds.length ? 'warning' : 'success'}>{t(`Закрыто: ${bulkCloseResult.succeeded}. Не удалось: ${bulkCloseResult.failedIds.length}.`)} {bulkCloseResult.failedIds.map((id) => `#${id}`).join(', ')}</AdminNotice>}
      {bulkAssignResult && <AdminNotice type={bulkAssignResult.failedIds.length ? (bulkAssignResult.succeeded ? 'warning' : 'error') : 'success'} className="bulk-assign-result">
        {t(`Назначено: ${bulkAssignResult.succeeded}. Не удалось: ${bulkAssignResult.failedIds.length}.`)}
        {bulkAssignResult.failedIds.length > 0 && <>
          <span> {t('Неудачные заявки: ')}{bulkAssignResult.failedIds.map((id) => `#${id}`).join(', ')}. </span>
          <button type="button" disabled={actionBusyId === 'bulk' || !bulkExecutor.trim()} onClick={() => runBulkAssign(bulkAssignResult.failedIds)}>{t("Повторить назначение")}</button>
        </>}
      </AdminNotice>}
      {loading && hasLoadedApplications && <AdminNotice>{t("Обновление заявок...")}</AdminNotice>}

      {/* Фильтры */}
      <div className="filters-section filters-section-compact">
        <details className="dashboard-settings">
          <summary>{t("Фильтры и настройки")}</summary>
          <div className="dashboard-settings-body">
            <div className="filters-group period-filter-card">
              <div className="filter-card-head">
                <div>
                  <span className="eyebrow">{t("Период заявок")}</span>
                  <h3>{t("Произвольный период")}</h3>
                </div>
              </div>
              <div className="date-filters">
                <div className="filter-group">
                  <label htmlFor="dashboard-date-from">{t("От")}</label>
                  <input id="dashboard-date-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div className="filter-group">
                  <label htmlFor="dashboard-date-to">{t("До")}</label>
                  <input id="dashboard-date-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                </div>
                <div className="filter-group dashboard-sort-order">
                  <label htmlFor="dashboard-sort-order">{t("Порядок")}</label>
                  <select id="dashboard-sort-order" value={sortMode} onChange={(event) => changeSortMode(event.target.value)}>
                    <option value="date_desc">{t("Сначала новые")}</option>
                    <option value="date_asc">{t("Сначала старые")}</option>
                  </select>
                </div>
                <div className="filter-actions">
                  <button type="button" onClick={applyFilters} className="btn-primary">{t("Применить период")}</button>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="active-filter-chips">
          <strong>{t("Активные фильтры:")}</strong>
          {activeFilterChips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.onRemove}>{t(chip.label)} ×</button>
          ))}
          <button type="button" className="clear-all-chip" onClick={clearFilters}>{t("Сбросить всё")}</button>
        </div>
      )}

      {/* Таблица */}
      {loading && !hasLoadedApplications ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>{t("Загрузка данных...")}</p>
        </div>
      ) : (
        <>
          {/* Заголовок таблицы с информацией о результатах */}
          <div className="table-header table-header-modern">
            <div>
              <h3>
                <span className="science-icon">📋</span>{t("Список заявок")}{displayedApplications.length > 0 && (
                  <span className="table-count">
                    ({displayedApplications.length}{t(" из ")}{filteredStats.total})
                  </span>
                )}
              </h3>
              <p>{t("Поиск работает по заявке, кабинету, сотруднику, телефону и исполнителю.")}</p>
            </div>
            <div className="table-tools">
              <div className="view-switch view-switch--workspace" role="group" aria-label={t("Вид заявок")}>
                <span className="view-switch-label">{t("Вид")}</span>
                <div className="view-switch-options">
                  <button
                    type="button"
                    aria-pressed={viewMode === 'table'}
                    className={viewMode === 'table' ? 'active' : ''}
                    onClick={() => { setViewMode('table'); userSettingsStorage.setItem('dashboard.viewMode', 'table'); }}
                  >
                    <span className="view-switch-icon view-switch-icon--table" aria-hidden="true"><i /><i /><i /><i /></span>
                    <span>{t("Таблица")}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === 'timeline'}
                    className={viewMode === 'timeline' ? 'active' : ''}
                    onClick={() => { setViewMode('timeline'); userSettingsStorage.setItem('dashboard.viewMode', 'timeline'); }}
                  >
                    <span className="view-switch-icon view-switch-icon--time" aria-hidden="true"><i /><i /><i /></span>
                    <span>{t("По времени")}</span>
                  </button>
                </div>
              </div>
              <label className="page-size-control">
                <span>{t("На странице")}</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    const nextLimit = Number(e.target.value);
                    setLimit(nextLimit);
                    userSettingsStorage.setItem(DASHBOARD_LIMIT_KEY, String(nextLimit));
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
                <strong>{t("Выбрано: ")}{selectedIds.length}</strong>
                <button type="button" onClick={() => setBulkAssignOpen(true)} disabled={actionBusyId === 'bulk'}>{t("Назначить исполнителя")}</button>
                <button type="button" onClick={runBulkClose} disabled={actionBusyId === 'bulk'}>{t("Закрыть")}</button>
                <button type="button" onClick={exportSelectedApplications} disabled={exportLoading}>{t(exportLoading ? 'Экспорт...' : `Экспорт выбранных — ${requestCountLabel(selectedIds.length)}`)}</button>
                <button type="button" onClick={() => setSelectedIds([])}>{t("Снять выбор")}</button>
                {bulkAssignOpen && (
                  <div className="bulk-assign-box">
                    <input
                      type="text"
                      value={bulkExecutor}
                      onChange={(event) => setBulkExecutor(event.target.value)}
                      placeholder={t("Исполнитель")}
                    />
                    <button type="button" onClick={runBulkAssign} disabled={!bulkExecutor.trim() || actionBusyId === 'bulk'}>{t("Назначить")}</button>
                    <button type="button" onClick={() => setBulkAssignOpen(false)}>{t("Отмена")}</button>
                  </div>
                )}
              </div>
            )}
            {viewMode === 'timeline' ? (
              <>
                <div className={`request-timeline request-timeline--${timelineCardDesign}`}>
                  {Object.entries(displayedApplications.reduce((groups, app) => {
                    const key = new Date(app.created_at || app.data).toLocaleDateString(getAdminLocale(), { timeZone: APPLICATION_TIME_ZONE });
                    (groups[key] ||= []).push(app);
                    return groups;
                  }, {})).map(([date, apps]) => (
                    <section className="timeline-day" key={date}>
                      <h4>{t(date)}</h4>
                      <div className="timeline-row">
                        {apps.sort((a, b) => new Date(a.created_at || a.data) - new Date(b.created_at || b.data)).map((app) => {
                          const status = getApplicationStatus(app);
                          const statusMeta = STATUS_META[status] || STATUS_META.new;
                          if (timelineCardDesign === 'modern') {
                            return (
                              <button
                                type="button"
                                className={`timeline-request timeline-request--modern timeline-request--${status}${String(openApplicationId) === String(app.id) ? ' timeline-request--target' : ''}`} data-application-id={app.id}
                                key={app.id}
                                onClick={() => openApplicationPanel(app)}
                              >
                                <span className="timeline-modern-head">
                                  <time>{t(formatTime(app.created_at || app.data))}</time>
                                  <span className={`timeline-modern-status timeline-modern-status--${status}`}>
                                    <i aria-hidden="true" />
                                    {t(statusMeta.label)}
                                  </span>
                                </span>
                                <strong className="timeline-title">{app.application || t('Без названия заявки')}</strong>
                                <span className="timeline-modern-details">
                                  <span className="timeline-cabinet">{t("Каб. ")}{app.cabinet || '—'}</span>
                                  <span className="timeline-person">{app.name || t('ФИО не указано')}</span>
                                  <span className="timeline-phone">{t("Тел. ")}{app.N_tel || '—'}</span>
                                </span>
                                <small className="timeline-request-id">{t("Заявка #")}{app.id}</small>
                              </button>
                            );
                          }
                          return (
                            <button type="button" className={`timeline-request${String(openApplicationId) === String(app.id) ? ' timeline-request--target' : ''}`} key={app.id} data-application-id={app.id} onClick={() => openApplicationPanel(app)}>
                              <strong className="timeline-title">{app.application || t('Без названия заявки')}</strong>
                              <span className="timeline-contact">{app.name || t('ФИО не указано')}{t(" · каб. ")}{app.cabinet || '—'}{t(" · тел. ")}{app.N_tel || '—'}</span>
                              <small>#{app.id} · {t(formatTime(app.created_at || app.data))} · {t(getStatusLabel(app))}</small>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            ) : <div className="table-responsive">
              <table className={`applications-table ${compactMode ? 'applications-table-compact' : ''}`}>
                <thead>
                  <tr>
                    <th className="select-column"><input type="checkbox" checked={displayedApplications.length > 0 && displayedApplications.every((app) => selectedIds.includes(app.id))} onChange={toggleSelectAllVisible} aria-label={t("Выбрать все заявки на странице")} /></th>
                    {isColumnVisible('employee') && <th>{t("Сотрудник")}</th>}
                    {isColumnVisible('request') && <th>{t("Заявка")}</th>}
                    {isColumnVisible('executor') && <th>{t("Исполнитель")}</th>}
                    {isColumnVisible('created') && <th>{t("Дата")}</th>}
                    {isColumnVisible('status') && <th>{t("Статус")}</th>}
                    {isColumnVisible('actions') && <th>{t("Действия")}</th>}
                  </tr>
                </thead>
                <tbody>
	                  {displayedApplications.length > 0 ? (
	                    displayedApplications.map((app) => {
                        const primaryAction = getPrimaryTableAction(app);
                        const status = app.status || (app.fl ? 'done' : 'new');
                        const applicationEmployee = getApplicationEmployee(app);
                        return (
	                      <tr
	                        key={app.id}
                        className={`${app.fl ? 'row-completed' : `row-${app.status || 'new'}`}${String(openApplicationId) === String(app.id) ? ' row-selected application-row--target' : ''}`} data-application-id={app.id}
	                        onClick={() => openApplicationPanel(app)}
	                      >
	                        <td className="select-column" onClick={(event) => event.stopPropagation()}>
                            <input type="checkbox" checked={selectedIds.includes(app.id)} onChange={(event) => toggleSelectApplication(event, app.id)} aria-label={t(`Выбрать заявку ${app.id}`)} />
                          </td>
	                        {isColumnVisible('employee') && <td className="cell-person">
	                          <strong>{app.name || t('Сотрудник')}</strong>
	                          {(applicationEmployee?.position || applicationEmployee?.department) && <span>{[applicationEmployee.position, applicationEmployee.department].filter(Boolean).join(' · ')}</span>}
	                          <span>{t("каб. ")}{applicationEmployee?.room || app.cabinet || '—'}{t(" · вн. ")}{applicationEmployee?.internal_phone || applicationEmployee?.phone || app.N_tel || '—'}{applicationEmployee?.external_phone ? t(` · внеш. ${applicationEmployee.external_phone}`) : ''}</span>
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
                            <strong>#{t(app.id || '—')} · {app.application || t('Без описания')}</strong>
                            <div className="application-badges">
                              {!isAdministratorCreatedApplication(app) && <span className="meta-badge category-badge">{t(getCategoryLabel(app.category))}</span>}
                              {!isAdministratorCreatedApplication(app) && <span className={`meta-badge priority-badge priority-${getPriorityClass(app.priority)}`}>{t(getPriorityLabel(app.priority))}</span>}
                              <span className="meta-badge source-badge">{t(getApplicationSourceLabel(app))}</span>
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
                            t('Не назначен')
                          )}
                        </td>}

                        {isColumnVisible('created') && <td className="cell-date cell-created">
                          <strong>{t(new Date(app.created_at || app.data).toLocaleDateString(getAdminLocale(), { timeZone: APPLICATION_TIME_ZONE }))}</strong>
                        </td>}
                        {isColumnVisible('status') && <td>{t(getStatusLabel(app))}</td>}
                        {isColumnVisible('actions') && <td className="cell-actions">
                          <div className="workflow-actions workflow-actions-compact">
                            <button
                              type="button"
                              className="primary-workflow-action"
                              disabled={actionBusyId === app.id}
                              onClick={(event) => runTableAction(event, app, () => primaryAction.action())}
                            >
                              {t(actionBusyId === app.id ? '...' : primaryAction.label)}
                            </button>
                            <div className="row-action-menu-wrap">
                              <button
                                type="button"
                                className="row-action-menu-toggle"
                                aria-label={t("Дополнительные действия")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenActionMenuId(openActionMenuId === app.id ? null : app.id);
                                }}
                              >
                                ⋯
                              </button>
                              {openActionMenuId === app.id && (
                                <div className="row-action-menu" onClick={(event) => event.stopPropagation()}>
                                  <button type="button" onClick={(event) => runTableAction(event, app, openApplicationPanel)}>{t("Открыть карточку")}</button>
                                  {app.employee_login && <a href={getOpenChatHref(app)}>{t("Открыть чат")}</a>}
                                  {isEmployeeCreatedApplication(app) && ['new', 'reopened'].includes(status) && <button type="button" onClick={(event) => runTableAction(event, app, openAcceptModal)}>{t("Взять в работу")}</button>}
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
                        {t(applicationsLoadError ? applicationsLoadError : searchTerm
                          ? `Не найдено заявок по запросу "${searchTerm}"`
                          : 'Нет заявок по данному фильтру')
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
        <aside className="application-side-panel" aria-label={t("Карточка заявки")}>
          <button type="button" className="side-panel-close" onClick={closeApplicationPanel}>×</button>
          <div className="side-panel-head">
            <span>{t(getStatusLabel(selectedApplication))}</span>
            <h2>{selectedApplication.application || t("Без названия заявки")}</h2>
            <small>{t("Заявка #")}{selectedApplication.id} · {t("Исполнитель")}: {selectedApplication.executor || selectedApplication.accepted_by || t("Не назначен")}</small>
            <p>{[selectedEmployee?.full_name || selectedApplication.name, selectedEmployee?.position, selectedEmployee?.department].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="side-panel-actions">
            {isEmployeeCreatedApplication(selectedApplication) && ['new', 'reopened'].includes(selectedApplication.status || 'new') && <button type="button" onClick={() => openAcceptModal(selectedApplication)}>{t("Взять в работу")}</button>}
            {selectedApplication.employee_login && <a href={getOpenChatHref(selectedApplication)}>{t("Открыть чат")}</a>}
            <a href={`/edit/${selectedApplication.id}`}>{t("Редактировать заявку")}</a>
            <button type="button" className="side-panel-delete" onClick={deleteSelectedApplication} disabled={actionBusyId === selectedApplication.id}>{t(actionBusyId === selectedApplication.id ? 'Удаляем…' : 'Удалить заявку')}</button>
          </div>
          <div className="next-action-card">
            <span>{t("Следующее действие")}</span>
            <strong>{t(getNextAction(selectedApplication))}</strong>
            <p>{t(getStatusDescription(selectedApplication))}</p>
          </div>
          <div className="side-panel-section">
            <h3>{t("Описание")}</h3>
            <p>{selectedApplication.application}</p>
          </div>
          <div className="side-panel-section"><h3>{t("Сотрудник")}</h3><div className="side-panel-grid">
            <div><strong>{t("ФИО")}</strong><span>{selectedEmployee?.full_name || selectedApplication.name || '—'}</span></div>
            <div><strong>{t("Должность")}</strong><span>{selectedEmployee?.position || '—'}</span></div>
            <div><strong>{t("Отдел")}</strong><span>{selectedEmployee?.department || '—'}</span></div>
            <div><strong>{t("Кабинет")}</strong><span>{selectedEmployee?.room || selectedApplication.cabinet || '—'}</span></div>
            <div><strong>{t("Внутренний телефон")}</strong><span>{selectedEmployee?.internal_phone || selectedEmployee?.phone || selectedApplication.N_tel || '—'}</span></div>
            <div><strong>{t("Внешний телефон")}</strong><span>{selectedEmployee?.external_phone || '—'}</span></div>
            <div><strong>Email</strong><span>{selectedEmployee?.email || (String(selectedApplication.employee_login || '').includes('@') ? selectedApplication.employee_login : '—')}</span></div>
            {selectedEmployee && selectedEmployee.is_active === false && <div><strong>{t("Статус справочника")}</strong><span>{t("Запись неактивна")}</span></div>}
          </div></div>
          <div className="time-summary-card">
            <strong>{t(getStatusLabel(selectedApplication))}</strong>
            {selectedAppTimes && (
              <span>
                {!isAdministratorCreatedApplication(selectedApplication) && selectedCumulativeWorkSeconds != null && <em>{t("Всего в работе: ")}{t(formatApplicationDuration(selectedCumulativeWorkSeconds))}</em>}
                {isAdministratorCreatedApplication(selectedApplication) && !selectedApplication.fl && selectedAppTimes.workSeconds != null && <em>{t("В работе: ")}{t(formatApplicationDuration(selectedAppTimes.workSeconds))}</em>}
                {selectedAppTimes.closedAt && selectedClosureSeconds != null && <em>{t("Подали → полностью закрыли: ")}{t(formatApplicationDuration(selectedClosureSeconds))}</em>}
              </span>
            )}
          </div>
          <details key={selectedApplication.id} className="side-panel-section side-panel-chronology"><summary>{t("Хронология")}</summary><div className="side-panel-grid">
            {!isAdministratorCreatedApplication(selectedApplication) && <div><strong>{t("Категория")}</strong><span>{t(selectedApplication.category || '—')}</span></div>}
            {!isAdministratorCreatedApplication(selectedApplication) && <div><strong>{t("Приоритет")}</strong><span>{t(selectedApplication.priority || 'Обычный')}</span></div>}
            <div><strong>{t("Источник")}</strong><span>{t(getApplicationSourceLabel(selectedApplication))}</span></div>
            <div><strong>{t("Исполнитель")}</strong><span>{t(isAdministratorCreatedApplication(selectedApplication) ? (selectedApplication.executor || '—') : (selectedApplication.executor || selectedApplication.accepted_by || 'Не назначен'))}</span></div>
            <div><strong>{t("Подана")}</strong><span>{t(formatCreatedAt(selectedApplication.created_at || selectedApplication.data))}</span></div>
            {selectedWorkCycles.length === 0 && !isAdministratorCreatedApplication(selectedApplication) && selectedAppTimes?.takenAt ? <div><strong>{t("Взята в работу")}</strong><span>{t(formatCreatedAt(selectedAppTimes.takenAt))}</span></div> : null}
            {selectedWorkCycles.length === 0 && !isAdministratorCreatedApplication(selectedApplication) && selectedAppTimes?.waitSeconds != null && <div><strong>{t("Подача → взятие")}</strong><span>{t(formatApplicationDuration(selectedAppTimes.waitSeconds))}</span></div>}
            {selectedWorkCycles.map((cycle, index) => {
              const takenAt = cycle.taken_at || cycle.started_at;
              const previousCycle = selectedWorkCycles[index - 1];
              const waitingSeconds = index === 0
                ? selectedAppTimes?.waitSeconds
                : secondsBetweenValues(previousCycle?.closed_at, takenAt);
              return <React.Fragment key={`${cycle.started_at}-${cycle.closed_at || 'active'}-${index}`}>
                <div><strong>{t(index === 0 ? 'Взята в работу' : 'Взята повторно в работу')}</strong><span>{t(formatCreatedAt(takenAt))}</span></div>
                {!isAdministratorCreatedApplication(selectedApplication) && waitingSeconds != null && <div><strong>{t("Подача → взятие")}</strong><span>{t(formatApplicationDuration(waitingSeconds))}</span></div>}
                {cycle.closed_at && !(selectedApplication.fl && index === selectedWorkCycles.length - 1) && <div><strong>{t("Переоткрыта")}</strong><span>{t(formatCreatedAt(cycle.closed_at))}</span></div>}
              </React.Fragment>;
            })}
            {selectedAppTimes?.closedAt && <div><strong>{t("Закрыта")}</strong><span>{t(formatCreatedAt(selectedAppTimes.closedAt))}</span></div>}
            {selectedAppTimes?.closedAt && selectedClosureSeconds != null && <div><strong>{t("Подали → полностью закрыли")}</strong><span>{t(formatApplicationDuration(selectedClosureSeconds))}</span></div>}
          </div></details>
          {selectedApplication.admin_comment && (
            <div className="side-panel-section">
              <h3>{t("Комментарий администратора")}</h3>
              <p>{selectedApplication.admin_comment}</p>
            </div>
          )}
          <div className="side-panel-section">
            <h3>{t("Что сделано")}</h3>
            <p>{selectedApplication.process || t('Пока не заполнено.')}</p>
          </div>
          {selectedApplication.employee_comment && (
            <div className="side-panel-section">
              <h3>{t("Комментарий сотрудника")}</h3>
              <p>{selectedApplication.employee_comment}</p>
            </div>
          )}
          {showApplicationActionHistory && <div className="side-panel-section">
            <h3>{t("История действий")}</h3>
            {eventsLoading && <p>{t("Загружаем историю…")}</p>}
            {!eventsLoading && applicationEvents.length === 0 && <p>{t("История пока пустая.")}</p>}
            <div className="event-list">
              {applicationEvents.map((event) => (
                <div key={event.id} className="event-item">
                  <strong>{t(event.event_type)}</strong>
                  <span>{event.actor_login || '—'} · {t(event.created_at ? formatApplicationDateTime(event.created_at, getAdminLocale()) : '—')}</span>
                  {event.comment && <p>{event.comment}</p>}
                </div>
              ))}
            </div>
          </div>}
        </aside>
      )}

      {workflowModal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setWorkflowModal(null)}>
          <form className="workflow-modal" onSubmit={submitWorkflowModal} onMouseDown={(event) => event.stopPropagation()}>
            <h2>{t(workflowModal.type === 'accept' ? 'Взять заявку в работу' : workflowModal.type === 'bulk-close' ? 'Подтвердить массовое закрытие' : 'Что сделано')}</h2>
            {workflowModal.type === 'accept' ? (
              <>
                <label>{t("Исполнитель")}<input value={workflowModal.values.executor} onChange={(event) => updateWorkflowModalValue('executor', event.target.value)} required /></label>
                <label>{t("Подойдут через, минут")}<input type="number" min="1" value={workflowModal.values.eta_minutes} onChange={(event) => updateWorkflowModalValue('eta_minutes', event.target.value)} required /></label>
                <label>{t("Комментарий сотруднику")}<textarea rows={4} value={workflowModal.values.admin_comment} onChange={(event) => updateWorkflowModalValue('admin_comment', event.target.value)} /></label>
              </>
            ) : workflowModal.type === 'bulk-close' ? (
              <>
                <p className="bulk-close-warning">{t("Будут закрыты заявки, по которым исполнитель завершил работу.")}</p>
                <ul className="bulk-close-list">{workflowModal.apps.map((app) => <li key={app.id}>#{app.id} — {app.application || t('Без описания')}</li>)}</ul>
                {workflowModal.blocked?.length > 0 && <p className="bulk-close-warning">{t("Не будут закрыты: ")}{workflowModal.blocked.length}{t(" заявок с другим статусом.")}</p>}
                <label>{t("Причина массового закрытия")}<textarea rows={4} value={workflowModal.values.reason} onChange={(event) => updateWorkflowModalValue('reason', event.target.value)} required placeholder={t("Например: подтверждено по телефону")} /></label>
              </>
            ) : (
              <label>{t("Что было сделано")}<textarea rows={5} value={workflowModal.values.process} onChange={(event) => updateWorkflowModalValue('process', event.target.value)} required /></label>
            )}
            <div className="modal-actions"><button type="button" onClick={() => setWorkflowModal(null)}>{t("Отмена")}</button><button type="submit" disabled={actionBusyId === (workflowModal.app?.id || 'bulk')}>{t(actionBusyId === (workflowModal.app?.id || 'bulk') ? 'Сохраняем…' : workflowModal.type === 'bulk-close' ? 'Закрыть выбранные' : 'Сохранить')}</button></div>
          </form>
        </div>
      )}

      {toast && <AdminNotice type={toast.type} className="admin-notice--floating">{t(toast.message)}</AdminNotice>}
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
    in_progress: 'Заявка в работе. Закроет сотрудник либо администратор.',
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
