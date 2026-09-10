import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams, Link } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import AddApplication from './pages/AddApplication';
import EditApplication from './pages/EditApplicationsTable';
import Login from './pages/Login';
import Register from './pages/Register';
import EmployeeSearch from './pages/EmployeeSearch';
import KnowledgeBase from './pages/KnowledgeBase';
import NetworkMap from './pages/NetworkMap';
import AdminSettings from './pages/AdminSettings';
import EmployeeChat from './pages/EmployeeChat';
import { ApplicationsProvider } from './context/ApplicationsProvider';
import './App.css';
import './styles/admin-system.css';
import Support from './components/Support';
import Statistics from './pages/StatisticsOverview';
import { API_BASE_URL } from './utils/apiConfig';
import { authFetch } from './utils/authFetch';


function ChatAdministration() {
  const { section } = useParams();
  return ['employees', 'audit', 'archive'].includes(section) ? <EmployeeChat adminSection={section} /> : <Navigate to="/chat-tools/audit" replace />;
}

function App() {
  return (
    <Router>
      <ApplicationsProvider>
        <AppWorkspace />
      </ApplicationsProvider>
    </Router>
  );
}

function AppWorkspace() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const [adminLanguage, setAdminLanguage] = useState(() => localStorage.getItem('adminLanguage') || 'ru');
  const [adminTheme, setAdminTheme] = useState(() => localStorage.getItem('adminTheme') || 'light');

  useEffect(() => {
    localStorage.setItem('adminLanguage', adminLanguage);
    localStorage.setItem('adminTheme', adminTheme);
  }, [adminLanguage, adminTheme]);

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Проверка авторизации...</p>
      </div>
    );
  }

  const isAdmin = user?.role === 'admin' || user?.serverRole === 'admin';
  const isEmployee = !isAdmin && (user?.role === 'employee' || user?.role === 'manager');
  const isAdminWorkspace = isAuthenticated && isAdmin;
  const isFullscreenAdminChat = isAdminWorkspace && location.pathname === '/employee';
  const showAdminShell = isAdminWorkspace && !isFullscreenAdminChat;

  return (
    <div className={`app-container ${showAdminShell ? `admin-workspace admin-theme-${adminTheme}` : ''}`} data-admin-language={adminLanguage}>
      {showAdminShell && <Sidebar language={adminLanguage} />}
      <div className={`app-content ${showAdminShell ? 'app-content--with-sidebar admin-shell-content' : ''}`}>
        {showAdminShell && <AdminTextTranslator language={adminLanguage} />}
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<Login mode="admin" />} />
          <Route path="/register" element={<AdminRoute><Register /></AdminRoute>} />

          <Route path="/employee" element={<ProtectedRoute><EmployeeChat /></ProtectedRoute>} />
          <Route path="/chat-tools/:section" element={<AdminRoute><ChatAdministration /></AdminRoute>} />

          <Route path="/" element={<AdminRoute><Dashboard /></AdminRoute>} />
          <Route path="/add" element={<AdminRoute><AddApplication /></AdminRoute>} />
          <Route path="/edit/:id" element={<AdminRoute><EditApplication /></AdminRoute>} />
          <Route path="/employee-search" element={<AdminRoute><EmployeeSearch /></AdminRoute>} />
          <Route path="/knowledge-base" element={<AdminRoute><KnowledgeBase /></AdminRoute>} />
          <Route path="/network-map" element={<AdminRoute><NetworkMap /></AdminRoute>} />
          <Route path="/settings" element={<AdminRoute><AdminSettings language={adminLanguage} theme={adminTheme} onLanguageChange={setAdminLanguage} onThemeChange={setAdminTheme} /></AdminRoute>} />
          <Route path="/statistics" element={<AdminRoute><Statistics /></AdminRoute>} />

          <Route path="/support" element={<Support />} />
          <Route path="*" element={<Navigate to={isEmployee ? '/employee' : '/'} replace />} />
        </Routes>
      </div>
    </div>
  );
}

const SIDEBAR_COPY = {
  ru: {
    product: 'НИОХ Система', descriptor: 'Центр управления', work: 'Работа', requests: 'Заявки', add: 'Новая заявка', chat: 'Чат',
    analytics: 'Аналитика', statistics: 'Статистика', system: 'Система', settings: 'Настройки', directory: 'Справочник сотрудников',
    access: 'Управление доступом', knowledge: 'База знаний', network: 'Диагностика сети', administrator: 'Администратор',
    language: 'Язык', appearance: 'Тема', light: 'Светлая', dark: 'Тёмная', logout: 'Выйти', navigation: 'Основная навигация', openMenu: 'Открыть меню'
  },
  en: {
    product: 'NIOCh System', descriptor: 'Control centre', work: 'Workspace', requests: 'Requests', add: 'New request', chat: 'Chat',
    analytics: 'Analytics', statistics: 'Statistics', system: 'System', settings: 'Settings', directory: 'Employee directory',
    access: 'Access management', knowledge: 'Knowledge base', network: 'Network diagnostics', administrator: 'Administrator',
    language: 'Language', appearance: 'Theme', light: 'Light', dark: 'Dark', logout: 'Sign out', navigation: 'Primary navigation', openMenu: 'Open menu'
  }
};

function Sidebar({ language }) {
  const { logout, user } = useAuth();
  const location = useLocation();
  const copy = SIDEBAR_COPY[language] || SIDEBAR_COPY.ru;
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [newRequestsCount, setNewRequestsCount] = useState(() => {
    try {
      return Number(localStorage.getItem('cachedNewRequests') || 0);
    } catch {
      return 0;
    }
  });
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [accessManagementVisible, setAccessManagementVisible] = useState(() => localStorage.getItem('admin.showAccessManagement') === 'true');
  // Ответы на подсчёт непрочитанных могут приходить не в том же порядке,
  // в котором были отправлены запросы. Храним версию, чтобы старый ответ
  // не вернул индикатор после того, как диалог уже был прочитан.
  const chatUnreadRequestVersionRef = useRef(0);

  useEffect(() => {
    const syncAccessManagementVisibility = () => setAccessManagementVisible(localStorage.getItem('admin.showAccessManagement') === 'true');
    window.addEventListener('admin:access-management-visibility', syncAccessManagementVisibility);
    return () => window.removeEventListener('admin:access-management-visibility', syncAccessManagementVisibility);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      if (window.innerWidth > 768) setIsMobileOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const fetchNewRequests = async () => {
      try {
        const adminLogin = encodeURIComponent(user?.username || user?.name || 'admin');
        const response = await authFetch(`${API_BASE_URL}/applications/unseen-count?admin_login=${adminLogin}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || isCancelled) return;
        const fresh = Number(data?.count || 0);
        setNewRequestsCount(fresh);
        localStorage.setItem('cachedNewRequests', String(fresh));
      } catch (error) {
        console.error('Ошибка загрузки новых заявок:', error);
      }
    };

    const fetchChatUnread = async () => {
      const requestVersion = ++chatUnreadRequestVersionRef.current;
      try {
        const response = await authFetch(`${API_BASE_URL}/chat/threads/unread-count`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || isCancelled || requestVersion !== chatUnreadRequestVersionRef.current) return;
        setChatUnreadCount(Number(data?.count || 0));
      } catch (error) {
        // Канал уведомлений чата может быть недоступен — не критично.
      }
    };

    const refreshAll = () => {
      fetchNewRequests();
      fetchChatUnread();
    };

    refreshAll();
    const firstRetry = setTimeout(refreshAll, 250);
    const secondRetry = setTimeout(refreshAll, 1000);
    const interval = setInterval(refreshAll, 5000);
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') refreshAll();
    };
    const handleChatRead = (event) => {
      // Не даём уже начатому до прочтения запросу перезаписать актуальное
      // значение, пока запрашиваем подтверждённый счётчик заново.
      chatUnreadRequestVersionRef.current += 1;
      const decrement = Math.max(0, Number(event?.detail?.decrement) || 0);
      if (decrement > 0) {
        setChatUnreadCount((current) => Math.max(0, current - decrement));
      }
      fetchChatUnread();
    };
    const handleApplicationStatusChanged = (event) => {
      const from = String(event?.detail?.from || '');
      const to = String(event?.detail?.to || '');
      const wasNew = ['new', 'reopened'].includes(from);
      const isNew = ['new', 'reopened'].includes(to);
      if (wasNew !== isNew) {
        setNewRequestsCount((current) => Math.max(0, current + (isNew ? 1 : -1)));
      }
      fetchNewRequests();
    };

    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', refreshOnVisible);
    window.addEventListener('applications:refresh', fetchNewRequests);
    window.addEventListener('applications:viewed', fetchNewRequests);
    window.addEventListener('chat:read-all', fetchChatUnread);
    window.addEventListener('chat:read', handleChatRead);
    window.addEventListener('applications:status-changed', handleApplicationStatusChanged);

    return () => {
      isCancelled = true;
      clearTimeout(firstRetry);
      clearTimeout(secondRetry);
      clearInterval(interval);
      window.removeEventListener('focus', refreshAll);
      document.removeEventListener('visibilitychange', refreshOnVisible);
      window.removeEventListener('applications:refresh', fetchNewRequests);
      window.removeEventListener('applications:viewed', fetchNewRequests);
      window.removeEventListener('chat:read-all', fetchChatUnread);
      window.removeEventListener('chat:read', handleChatRead);
      window.removeEventListener('applications:status-changed', handleApplicationStatusChanged);
    };
  }, [user?.name, user?.username]);

  const isActive = (path) => location.pathname === path;

  return (
    <>
      {isMobile && (
        <button className="mobile-menu-toggle" onClick={() => setIsMobileOpen(!isMobileOpen)} aria-label={copy.openMenu}>
          <span aria-hidden="true" />
        </button>
      )}

      {isMobileOpen && isMobile && <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />}

      <div className={`sidebar ${isMobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo"><span className="logo-mark">N</span></div>
          <div className="sidebar-title">
            <h2>{copy.product}</h2>
            <p>{copy.descriptor}</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label={copy.navigation}>
          <ul>
            <li className="nav-group-title">{copy.work}</li>
            <li className={isActive('/') ? 'nav-item active' : 'nav-item'}>
              <Link to="/" className="nav-link">
                <span className="nav-icon nav-icon--requests" aria-hidden="true" />
                <span className="nav-text">{copy.requests}</span>
                {newRequestsCount > 0 && <span className="nav-badge">{newRequestsCount}</span>}
              </Link>
            </li>
            <li className={isActive('/add') ? 'nav-item active' : 'nav-item'}><Link to="/add" className="nav-link"><span className="nav-icon nav-icon--add" aria-hidden="true" /><span className="nav-text">{copy.add}</span></Link></li>
            <li className={isActive('/employee') ? 'nav-item active' : 'nav-item'}><Link to="/employee" className="nav-link"><span className="nav-icon nav-icon--chat" aria-hidden="true" /><span className="nav-text">{copy.chat}</span>{chatUnreadCount > 0 && <span className="nav-badge">{chatUnreadCount > 99 ? '99+' : chatUnreadCount}</span>}</Link></li>
            <li className="nav-item"><Link to="/chat-tools/audit" className="nav-link"><span className="nav-icon nav-icon--chat" aria-hidden="true" /><span className="nav-text">{language === 'ru' ? 'Управление чатом' : 'Chat administration'}</span></Link></li>
            <li className="nav-group-title">{copy.analytics}</li>
            <li className={isActive('/statistics') ? 'nav-item active' : 'nav-item'}><Link to="/statistics" className="nav-link"><span className="nav-icon nav-icon--chart" aria-hidden="true" /><span className="nav-text">{copy.statistics}</span></Link></li>
            <li className="nav-group-title">{copy.system}</li>
            <li className={isActive('/settings') ? 'nav-item active' : 'nav-item'}><Link to="/settings" className="nav-link"><span className="nav-icon nav-icon--settings" aria-hidden="true" /><span className="nav-text">{copy.settings}</span></Link></li>
            <li className={isActive('/employee-search') ? 'nav-item active' : 'nav-item'}><Link to="/employee-search" className="nav-link"><span className="nav-icon nav-icon--people" aria-hidden="true" /><span className="nav-text">{copy.directory}</span></Link></li>
            {accessManagementVisible && <li className={isActive('/register') ? 'nav-item active' : 'nav-item'}><Link to="/register" className="nav-link"><span className="nav-icon nav-icon--account" aria-hidden="true" /><span className="nav-text">{copy.access}</span></Link></li>}
            <li className={isActive('/knowledge-base') ? 'nav-item active' : 'nav-item'}><Link to="/knowledge-base" className="nav-link"><span className="nav-icon nav-icon--book" aria-hidden="true" /><span className="nav-text">{copy.knowledge}</span></Link></li>
            <li className={isActive('/network-map') ? 'nav-item active' : 'nav-item'}><Link to="/network-map" className="nav-link"><span className="nav-icon nav-icon--network" aria-hidden="true" /><span className="nav-text">{copy.network}</span></Link></li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar"><span className="user-icon">{String(user?.name || 'A').trim().charAt(0).toUpperCase()}</span></div>
            <div className="user-details">
              <span className="user-name">{user?.name || 'Администратор'}</span>
              <span className="user-role">{copy.administrator}</span>
            </div>
          </div>
          <button onClick={() => { logout(); setIsMobileOpen(false); }} className="logout-btn">
            <span className="logout-icon" aria-hidden="true" />
            <span>{copy.logout}</span>
          </button>
        </div>
      </div>
    </>
  );
}

const ADMIN_TRANSLATIONS = {
  'Заявки': 'Requests', 'Новая заявка': 'New request', 'Статистика': 'Statistics', 'Настройки': 'Settings',
  'Справочник сотрудников': 'Employee directory', 'Управление доступом': 'Access management', 'База знаний': 'Knowledge base',
  'Диагностика сети': 'Network diagnostics', 'Поиск сотрудников': 'Employee search', 'Поиск': 'Search', 'Очистить': 'Clear',
  'Добавить новую заявку': 'Add a new request', 'Создание новой заявки в системе': 'Create a new request in the system',
  'Основная информация': 'Main information', 'Описание заявки': 'Request description', 'Статус заявки': 'Request status',
  'Сохранить': 'Save', 'Сохраняем…': 'Saving…', 'Отмена': 'Cancel', 'Удалить': 'Delete', 'Редактировать': 'Edit',
  'Обновить': 'Refresh', 'Загрузка...': 'Loading…', 'Загрузка…': 'Loading…', 'Ошибка': 'Error', 'Готово': 'Done',
  'Фильтры': 'Filters', 'Фильтры и настройки': 'Filters and settings', 'Показать фильтры': 'Show filters', 'Скрыть фильтры': 'Hide filters',
  'Все': 'All', 'Новые': 'New', 'В работе': 'In progress', 'Просроченные': 'Overdue', 'Завершённые': 'Completed',
  'Дата': 'Date', 'Сотрудник': 'Employee', 'Кабинет': 'Office', 'Телефон': 'Phone', 'Исполнитель': 'Assignee',
  'Заявка': 'Request', 'Статус': 'Status', 'Приоритет': 'Priority', 'Действия': 'Actions', 'Категория': 'Category',
  'Открыть': 'Open', 'Закрыть': 'Close', 'Назначить': 'Assign', 'Взять в работу': 'Start work', 'Хронология': 'Timeline',
  'Экспорт': 'Export', 'Представления': 'Views', 'Очередь': 'Queue', 'Настройка колонок': 'Column settings',
  'Нет данных': 'No data', 'Ничего не найдено': 'Nothing found', 'Заявки не найдены': 'No requests found',
  'Новая учётная запись': 'New account', 'Создать учётную запись': 'Create account', 'Логин': 'Login', 'Пароль': 'Password',
  'Имя': 'First name', 'Фамилия': 'Last name', 'Отчество': 'Middle name', 'Роль': 'Role', 'Должность': 'Position',
  'Электронная почта': 'Email', 'Повторите пароль': 'Repeat password', 'Показать пароль': 'Show password',
  'Статьи': 'Articles', 'Добавить новую статью': 'Add a new article', 'Название': 'Title', 'Решение': 'Solution',
  'Добавить статью': 'Add article', 'Изменить': 'Edit', 'Загрузить изображения': 'Upload images',
  'Сетка / маска сети': 'Network / subnet mask', 'Свободные и занятые IP-адреса': 'Available and occupied IP addresses',
  'Сеть': 'Network', 'IP-адрес': 'IP address', 'Устройство': 'Device', 'Свободен': 'Available', 'Занят': 'Occupied',
  'Служебные обновления': 'Service updates', 'Редкие операции вынесены из рабочих экранов.': 'Infrequent operations are kept outside everyday workflows.',
  'Обновить справочник': 'Refresh directory', 'Обновить IP-сетку': 'Refresh IP grid',
  'Показывать в карточке заявки блок «История действий».': 'Show the “Action history” section in the request card.',
  'История показывается': 'History is shown', 'История скрыта': 'History is hidden',
  'Аналитика заявок': 'Request analytics', 'Объём обращений, текущие состояния и нагрузка исполнителей': 'Request volume, current states and assignee workload', 'Период': 'Period',
  'За 7 дней': 'Last 7 days', 'За 30 дней': 'Last 30 days', 'За 90 дней': 'Last 90 days',
  'Последние 7 дней': 'Last 7 days', 'Последние 30 дней': 'Last 30 days', 'Последние 90 дней': 'Last 90 days',
  'Последний день': 'Last day', 'Последние 3 месяца': 'Last 3 months', 'Последние 6 месяцев': 'Last 6 months',
  '1 день': '1 day', '7 дней': '7 days', '1 месяц': '1 month', '3 месяца': '3 months', '6 месяцев': '6 months',
  'Всё время': 'All time', 'Все исполнители': 'All assignees', 'Все категории': 'All categories',
  'Всего заявок': 'Total requests', 'Открыто сейчас': 'Open now', 'Среднее время решения': 'Average resolution time',
  'Новые и повторные': 'New and reopened', 'ожидают начала работы': 'waiting to be started',
  'в выбранном периоде': 'in the selected period', 'включая ожидание подтверждения': 'including confirmation wait',
  'Выполненные': 'Completed', 'Динамика заявок': 'Request trend', 'Нагрузка по исполнителям': 'Assignee workload',
  'Количество обращений по дням': 'Requests by day', 'Одиночные, затем пары и тройка': 'Individuals, then pairs and the trio',
  'Наведите на точку, чтобы увидеть заявки. Нажмите название — откроется карточка.': 'Hover over a point to see requests. Select a title to open its details.',
  'Зажмите график и ведите влево — больше времени, вправо — подробнее': 'Drag the chart left for a wider period or right for more detail',
  'Расширяем период': 'Widening the period', 'Приближаем период': 'Zooming in', 'Ведите влево или вправо': 'Drag left or right',
  'Статусы заявок': 'Request statuses', 'Текущее распределение выбранной выборки': 'Current distribution of the selected set',
  'Сводка по исполнителям': 'Assignee summary', 'Тип': 'Type', 'Всего': 'Total', 'Среднее до закрытия': 'Average time to close',
  'Один исполнитель': 'Individual', 'Пара': 'Pair', 'Тройка': 'Trio', 'Сбросить': 'Reset',
  'В статистике учитываются только Повисок Е.В., Андреев Р.В., Польников Д.В. и их сочетания': 'Statistics include only Povisok E.V., Andreev R.V., Polnikov D.V. and their combinations',
  'За выбранный период заявок нет': 'No requests in the selected period', 'Нет данных для распределения': 'No distribution data',
  'нет заявок в выборке': 'no requests in the selected set', 'от выборки': 'of the selected set',
  'Карточка заявки': 'Request details', 'Комментарий сотруднику': 'Comment for employee', 'Что сделано': 'Work completed',
  'Подтвердить': 'Confirm', 'Закрыть выбранные': 'Close selected', 'Выйти': 'Sign out'
};

const translateAdminText = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return value;
  if (ADMIN_TRANSLATIONS[normalized]) return String(value).replace(normalized, ADMIN_TRANSLATIONS[normalized]);
  return String(value)
    .replace(/Заявка #(\d+)/g, 'Request #$1')
    .replace(/Найдено:\s*(\d+)/g, 'Found: $1')
    .replace(/Занято:\s*(\d+)/g, 'Occupied: $1')
    .replace(/Свободно:\s*(\d+)/g, 'Available: $1')
    .replace(/Страница\s*(\d+)\s*из\s*(\d+)/g, 'Page $1 of $2');
};

function AdminTextTranslator({ language }) {
  // Храним «оригиналы» ТОЛЬКО для узлов/атрибутов, которые мы реально
  // перевели в английский. Это критично: нельзя кешировать любой текст —
  // динамические значения (числа, счётчики) перерисовываются React, и
  // «восстановление» устаревшего оригинала сбрасывало их в ноль.
  const originalsRef = useRef(new WeakMap());
  const elementOriginalsRef = useRef(new WeakMap());

  useEffect(() => {
    const root = document.querySelector('.admin-shell-content');
    if (!root) return undefined;

    const translateTextNode = (node) => {
      const current = node.textContent || '';
      const translated = translateAdminText(current);
      if (translated === current) return;
      if (!originalsRef.current.has(node)) {
        originalsRef.current.set(node, current);
      }
      if (node.textContent !== translated) node.textContent = translated;
    };

    const restoreTextNode = (node) => {
      const original = originalsRef.current.get(node);
      if (original === undefined || !node.isConnected) return;
      if (node.textContent !== original) node.textContent = original;
      originalsRef.current.delete(node);
    };

    const textPass = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        const skipped = !parent || ['SCRIPT', 'STYLE'].includes(parent.tagName) || Boolean(parent.closest('[data-no-translate]'));
        if (!skipped) {
          if (language === 'en') {
            translateTextNode(node);
          } else if (originalsRef.current.has(node)) {
            restoreTextNode(node);
          }
        }
        node = walker.nextNode();
      }
    };

    const attributePass = () => {
      const attributes = ['placeholder', 'title', 'aria-label'];
      root.querySelectorAll('[placeholder], [title], [aria-label]').forEach((element) => {
        attributes.forEach((attribute) => {
          if (!element.hasAttribute(attribute)) return;
          const current = element.getAttribute(attribute);
          const translated = translateAdminText(current);
          if (language === 'en') {
            if (translated === current) return;
            if (!elementOriginalsRef.current.has(element)) {
              elementOriginalsRef.current.set(element, {});
            }
            const saved = elementOriginalsRef.current.get(element);
            if (!(attribute in saved)) saved[attribute] = current;
            if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
          } else {
            const saved = elementOriginalsRef.current.get(element);
            if (saved && attribute in saved) {
              const original = saved[attribute];
              if (element.getAttribute(attribute) !== original) element.setAttribute(attribute, original);
              delete saved[attribute];
              if (Object.keys(saved).length === 0) elementOriginalsRef.current.delete(element);
            }
          }
        });
      });
    };

    const applyTranslations = () => {
      textPass();
      attributePass();
      document.documentElement.lang = language;
    };

    applyTranslations();
    const observer = new MutationObserver(() => window.requestAnimationFrame(applyTranslations));
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      // Откатываем наши правки при смене языка/размонтировании.
      if (language === 'en') {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (originalsRef.current.has(node)) restoreTextNode(node);
          node = walker.nextNode();
        }
        root.querySelectorAll('[placeholder], [title], [aria-label]').forEach((element) => {
          const saved = elementOriginalsRef.current.get(element);
          if (!saved) return;
          ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
            if (attribute in saved) element.setAttribute(attribute, saved[attribute]);
          });
          elementOriginalsRef.current.delete(element);
        });
      }
      originalsRef.current = new WeakMap();
      elementOriginalsRef.current = new WeakMap();
    };
  }, [language]);

  return null;
}

function ProtectedRoute({ children, loginPath = '/login' }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="app-loading"><div className="spinner"></div><p>Проверка авторизации...</p></div>;
  }

  return !isAuthenticated ? <Navigate to={loginPath} replace /> : children;
}

function AdminRoute({ children }) {
  const { user } = useAuth();

  return (
    <ProtectedRoute loginPath="/admin">
      {user?.role === 'admin' || user?.serverRole === 'admin' ? children : <Navigate to="/employee" replace />}
    </ProtectedRoute>
  );
}

export default App;
