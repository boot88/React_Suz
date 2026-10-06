import useNewApplicationCount from './hooks/useNewApplicationCount';
import MaintenanceNotice from './components/MaintenanceNotice';
import MandatoryPasswordChange from './components/MandatoryPasswordChange';
import AdminNotice from './components/AdminNotice';
import { translateAdminText as t } from './utils/adminTranslation';
import { userSettingsStorage, PREFERENCES_EVENT, flushPreferenceSync } from './utils/userPreferences';
import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import './App.css';
import './styles/admin-system.css';
import { API_BASE_URL } from './utils/apiConfig';
import { authFetch } from './utils/authFetch';
import { ADMIN_WORKSPACE_TRANSITION_EVENT, requestAdminWorkspaceTransition } from './utils/adminWorkspaceTransition';
import { WELCOME_NOTICE_DURATION_MS, requestWelcomeGreeting, hasSeenWelcomeGreeting, markWelcomeGreetingSeen } from './utils/welcomeGreeting';


const Dashboard = lazy(() => import('./pages/Dashboard'));
const AddApplication = lazy(() => import('./pages/AddApplication'));
const EditApplication = lazy(() => import('./pages/EditApplicationsTable'));
const EmployeeSearch = lazy(() => import('./pages/EmployeeSearch'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const NetworkMap = lazy(() => import('./pages/NetworkMap'));
const AdminSettings = lazy(() => import('./pages/AdminSettings'));
const EmployeeChat = lazy(() => import('./pages/EmployeeChat'));
const Support = lazy(() => import('./components/Support'));
const Statistics = lazy(() => import('./pages/StatisticsOverview'));

function ChatAdministration() {
  const { section } = useParams();
  return section === 'audit' ? <EmployeeChat adminSection={section} /> : <Navigate to="/chat-tools/audit" replace />;
}

// Разделы чата в админке: «Управление чатом» и сам чат не считаются входом в админку,
// поэтому приветствие там не показываем.
const ADMIN_GREETING_EXCLUDED_PATHS = ['/chat-tools'];

// Приветствие при первом входе: «Добро пожаловать, Евгений! Сегодня вторник, 15 сент.»
// Админ видит его при первом входе в админку, сотрудник — при входе в чат (EmployeeChat).
function AdminWelcomeNotice({ language }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [notice, setNotice] = useState(null);
  const isExcludedPath = ADMIN_GREETING_EXCLUDED_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    if (!user?.username || isExcludedPath) return undefined;
    if (hasSeenWelcomeGreeting(user.username)) return undefined;

    markWelcomeGreetingSeen(user.username);
    requestWelcomeGreeting(user, language === 'en').then(setNotice);
    return undefined;
  }, [isExcludedPath, language, user]);

  // Приветствие исчезает само через несколько секунд.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), WELCOME_NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;

  return (
    <div className="admin-welcome-notice" role="status" aria-live="polite">
      <span>{notice}</span>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppWorkspace />
    </Router>
  );
}

function AppWorkspace() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const adminRequestsCount = useNewApplicationCount(isAuthenticated && (user?.role === 'admin' || user?.serverRole === 'admin') ? user : null);
  const navigate = useNavigate();
  const [adminLanguage, setAdminLanguage] = useState(() => userSettingsStorage.getItem('adminLanguage') || 'en');
  const [adminTheme, setAdminTheme] = useState(() => userSettingsStorage.getItem('adminTheme') || 'light');
  const [workspaceTransition, setWorkspaceTransition] = useState(null);
  const workspaceTransitionTimersRef = useRef([]);
  const currentPathRef = useRef(location.pathname);
  const navigateRef = useRef(navigate);

  useEffect(() => {
    if (isAuthenticated && (user?.role === 'admin' || user?.serverRole === 'admin') && location.pathname !== '/employee') document.documentElement.lang = adminLanguage;
  }, [adminLanguage, isAuthenticated, location.pathname, user?.role, user?.serverRole]);

  useEffect(() => { currentPathRef.current = location.pathname; }, [location.pathname]);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  const [preferenceSyncError, setPreferenceSyncError] = useState('');
  useEffect(() => {
    const sync = (event) => {
      if (event?.detail?.login && event.detail.login !== String(user?.username || '').toLowerCase()) return;
      setAdminLanguage(userSettingsStorage.getItem('adminLanguage') || 'en');
      setAdminTheme(userSettingsStorage.getItem('adminTheme') || 'light');
      setPreferenceSyncError(event?.detail?.error || '');
    };
    sync();
    window.addEventListener(PREFERENCES_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(PREFERENCES_EVENT, sync); window.removeEventListener('storage', sync); };
  }, [user?.username]);

  useEffect(() => {
    const clearTransitionTimers = () => {
      workspaceTransitionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      workspaceTransitionTimersRef.current = [];
    };
    const handleWorkspaceTransition = (event) => {
      const to = String(event?.detail?.to || '').trim();
      if (!to || to === currentPathRef.current) return;
      clearTransitionTimers();
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setWorkspaceTransition(null);
        navigateRef.current(to);
        return;
      }
      const toChat = to.split('?')[0] === '/employee';
      setWorkspaceTransition({
        phase: 'covering',
        direction: toChat ? 'to-chat' : 'to-admin',
        label: toChat ? 'Открываем чат' : 'Возвращаемся в админку'
      });
      workspaceTransitionTimersRef.current.push(window.setTimeout(() => {
        navigateRef.current(to);
        setWorkspaceTransition((current) => current ? { ...current, phase: 'revealing' } : null);
      }, 230));
      workspaceTransitionTimersRef.current.push(window.setTimeout(() => {
        setWorkspaceTransition(null);
        workspaceTransitionTimersRef.current = [];
      }, 620));
    };
    window.addEventListener(ADMIN_WORKSPACE_TRANSITION_EVENT, handleWorkspaceTransition);
    return () => {
      window.removeEventListener(ADMIN_WORKSPACE_TRANSITION_EVENT, handleWorkspaceTransition);
      clearTransitionTimers();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Проверка авторизации...</p>
      </div>
    );
  }

  if (isAuthenticated && user?.mustChangePassword) return <MandatoryPasswordChange />;

  const isAdmin = user?.role === 'admin' || user?.serverRole === 'admin';
  const isEmployee = !isAdmin && (user?.role === 'employee' || user?.role === 'manager');
  const isAdminWorkspace = isAuthenticated && isAdmin;
  const isFullscreenAdminChat = isAdminWorkspace && location.pathname === '/employee';
  const showAdminShell = isAdminWorkspace && !isFullscreenAdminChat;

  return (
    <div className={`app-container ${showAdminShell ? `admin-workspace admin-theme-${adminTheme}` : ''}`} data-admin-language={adminLanguage}>
      {showAdminShell && <Sidebar language={adminLanguage} requestsCount={adminRequestsCount} />}
      <div className={`app-content ${showAdminShell ? 'app-content--with-sidebar admin-shell-content' : ''}`}>
        {isAuthenticated && preferenceSyncError && (showAdminShell ? <AdminNotice type="error">{t(preferenceSyncError, adminLanguage)} <button type="button" onClick={flushPreferenceSync}>{t('Повторить сохранение', adminLanguage)}</button></AdminNotice> : <div role="alert" className="settings-sync-error">{t(preferenceSyncError, adminLanguage)} <button type="button" onClick={flushPreferenceSync}>{t('Повторить сохранение', adminLanguage)}</button></div>)}
        {showAdminShell && <MaintenanceNotice />}
        {showAdminShell && <AdminWelcomeNotice language={adminLanguage} />}
        <div key={showAdminShell ? location.pathname : 'public'} className={showAdminShell ? 'admin-route-content' : undefined}>
        <Suspense fallback={<div className="app-loading" role="status">{t("Загрузка данных...")}</div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<Login mode="admin" />} />

          <Route path="/employee" element={<ProtectedRoute><EmployeeChat /></ProtectedRoute>} />
          <Route path="/chat-tools/:section" element={<AdminRoute><ChatAdministration /></AdminRoute>} />

          <Route path="/" element={<AdminRoute><Dashboard /></AdminRoute>} />
          <Route path="/add" element={<AdminRoute><AddApplication /></AdminRoute>} />
          <Route path="/edit/:id" element={<AdminRoute><EditApplication /></AdminRoute>} />
          <Route path="/employee-search" element={<AdminRoute><EmployeeSearch /></AdminRoute>} />
          <Route path="/knowledge-base" element={<AdminRoute><KnowledgeBase /></AdminRoute>} />
          <Route path="/network-map" element={<AdminRoute><NetworkMap /></AdminRoute>} />
          <Route path="/settings" element={<AdminRoute><AdminSettings language={adminLanguage} theme={adminTheme} onLanguageChange={(value) => userSettingsStorage.setItem('adminLanguage', value)} onThemeChange={(value) => userSettingsStorage.setItem('adminTheme', value)} /></AdminRoute>} />
          <Route path="/statistics" element={<AdminRoute><Statistics /></AdminRoute>} />

          <Route path="/support" element={<Support />} />
          <Route path="*" element={<Navigate to={isEmployee ? '/employee' : '/'} replace />} />
        </Routes>
        </Suspense>
        </div>
      </div>
      {workspaceTransition && (
        <div className={`admin-workspace-transition is-${workspaceTransition.phase} ${workspaceTransition.direction}`} role="status" aria-live="polite">
          <div className="admin-workspace-transition__content">
            <span className="admin-workspace-transition__mark" aria-hidden="true"><i /><i /></span>
            <strong>{workspaceTransition.label}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

const SIDEBAR_COPY = {
  ru: {
    product: 'НИОХ Система', descriptor: 'Центр управления', work: 'Работа', requests: 'Заявки', add: 'Новая заявка',
    communication: 'Общение', chat: 'Чат', broadcast: 'Рассылка сотрудникам', chatAdmin: 'Управление чатом',
    directories: 'Справочники', directory: 'Справочник сотрудников', knowledge: 'База знаний',
    diagnostics: 'Диагностика', statistics: 'Статистика', network: 'Диагностика сети',
    administration: 'Администрирование', settings: 'Настройки', administrator: 'Администратор',
    language: 'Язык', appearance: 'Тема', light: 'Светлая', dark: 'Тёмная', logout: 'Выйти', navigation: 'Основная навигация', openMenu: 'Открыть меню'
  },
  en: {
    product: 'NIOCh System', descriptor: 'Control centre', work: 'Workspace', requests: 'Requests', add: 'New request',
    communication: 'Communication', chat: 'Chat', broadcast: 'Employee broadcast', chatAdmin: 'Chat administration',
    directories: 'Reference data', directory: 'Employee directory', knowledge: 'Knowledge base',
    diagnostics: 'Diagnostics', statistics: 'Statistics', network: 'Network diagnostics',
    administration: 'Administration', settings: 'Settings', administrator: 'Administrator',
    language: 'Language', appearance: 'Theme', light: 'Light', dark: 'Dark', logout: 'Sign out', navigation: 'Primary navigation', openMenu: 'Open menu'
  }
};

export function Sidebar({ language, requestsCount }) {
  const { logout, user } = useAuth();
  const location = useLocation();
  const copy = SIDEBAR_COPY[language] || SIDEBAR_COPY.ru;
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const localRequestsCount = useNewApplicationCount(requestsCount === undefined ? user : null);
  const newRequestsCount = requestsCount ?? localRequestsCount;
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  // Ответы на подсчёт непрочитанных могут приходить не в том же порядке,
  // в котором были отправлены запросы. Храним версию, чтобы старый ответ
  // не вернул индикатор после того, как диалог уже был прочитан.
  const chatUnreadRequestVersionRef = useRef(0);

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
    let chatBusy = false, chatPending = false;

    const fetchChatUnread = async () => {
      if (isCancelled || document.visibilityState === 'hidden') return;
      if (chatBusy) { chatPending = true; return; }
      chatBusy = true;
      const requestVersion = ++chatUnreadRequestVersionRef.current;
      try {
        const response = await authFetch(`${API_BASE_URL}/chat/threads/unread-count`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || isCancelled || requestVersion !== chatUnreadRequestVersionRef.current) return;
        setChatUnreadCount(Number(data?.count || 0));
      } catch (error) {
        // Канал уведомлений чата может быть недоступен — не критично.
      } finally {
        chatBusy = false;
        if (chatPending) { chatPending = false; fetchChatUnread(); }
      }
    };

    const refreshAll = () => {
      fetchChatUnread();
    };

    refreshAll();
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
    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', refreshOnVisible);
    window.addEventListener('chat:read-all', fetchChatUnread);
    window.addEventListener('chat:read', handleChatRead);

    return () => {
      isCancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', refreshAll);
      document.removeEventListener('visibilitychange', refreshOnVisible);
      window.removeEventListener('chat:read-all', fetchChatUnread);
      window.removeEventListener('chat:read', handleChatRead);
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
            <li className="nav-group-title">{copy.communication}</li>
            <li className={isActive('/employee') ? 'nav-item active' : 'nav-item'}><Link to="/employee" className="nav-link" onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setIsMobileOpen(false); requestAdminWorkspaceTransition('/employee'); }}><span className="nav-icon nav-icon--chat" aria-hidden="true" /><span className="nav-text">{copy.chat}</span>{chatUnreadCount > 0 && <span className="nav-badge">{chatUnreadCount > 99 ? '99+' : chatUnreadCount}</span>}</Link></li>
            <li className="nav-item"><Link to="/employee?broadcast=1" className="nav-link" onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setIsMobileOpen(false); requestAdminWorkspaceTransition('/employee?broadcast=1'); }}><span className="nav-icon nav-icon--chat" aria-hidden="true" /><span className="nav-text">{copy.broadcast}</span></Link></li>
            <li className={location.pathname.startsWith('/chat-tools') ? 'nav-item active' : 'nav-item'}><Link to="/chat-tools/audit" className="nav-link"><span className="nav-icon nav-icon--chat" aria-hidden="true" /><span className="nav-text">{copy.chatAdmin}</span></Link></li>
            <li className="nav-group-title">{copy.directories}</li>
            <li className={isActive('/employee-search') ? 'nav-item active' : 'nav-item'}><Link to="/employee-search" className="nav-link"><span className="nav-icon nav-icon--people" aria-hidden="true" /><span className="nav-text">{copy.directory}</span></Link></li>
            <li className={isActive('/knowledge-base') ? 'nav-item active' : 'nav-item'}><Link to="/knowledge-base" className="nav-link"><span className="nav-icon nav-icon--book" aria-hidden="true" /><span className="nav-text">{copy.knowledge}</span></Link></li>
            <li className="nav-group-title">{copy.diagnostics}</li>
            <li className={isActive('/statistics') ? 'nav-item active' : 'nav-item'}><Link to="/statistics" className="nav-link"><span className="nav-icon nav-icon--chart" aria-hidden="true" /><span className="nav-text">{copy.statistics}</span></Link></li>
            <li className={isActive('/network-map') ? 'nav-item active' : 'nav-item'}><Link to="/network-map" className="nav-link"><span className="nav-icon nav-icon--network" aria-hidden="true" /><span className="nav-text">{copy.network}</span></Link></li>
            <li className="nav-group-title">{copy.administration}</li>
            <li className={isActive('/settings') ? 'nav-item active' : 'nav-item'}><Link to="/settings" className="nav-link"><span className="nav-icon nav-icon--settings" aria-hidden="true" /><span className="nav-text">{copy.settings}</span></Link></li>
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
