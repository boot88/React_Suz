import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import AddApplication from './pages/AddApplication';
import EditApplication from './pages/EditApplicationsTable';
import Login from './pages/Login';
import Register from './pages/Register';
import EmployeeSearch from './pages/EmployeeSearch';
import KnowledgeBase from './pages/KnowledgeBase';
import NetworkMap from './pages/NetworkMap';
import EmployeeChat from './pages/EmployeeChat';
import { ApplicationsProvider } from './context/ApplicationsProvider';
import './App.css';
import Support from './components/Support';
import Statistics from './pages/StatisticsOverview';
import { API_BASE_URL } from './utils/apiConfig';
import { authFetch } from './utils/authFetch';


function App() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Проверка авторизации...</p>
      </div>
    );
  }

  const isEmployee = user?.role === 'employee' || user?.role === 'manager';

  return (
    <Router>
      <ApplicationsProvider>
        <div className="app-container">
          {isAuthenticated && !isEmployee && <Sidebar />}
          <div className={`app-content ${isAuthenticated && !isEmployee ? 'app-content--with-sidebar' : ''}`}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/admin" element={<Login mode="admin" />} />
              <Route path="/register" element={<AdminRoute><Register /></AdminRoute>} />

              <Route path="/employee" element={<ProtectedRoute><EmployeeChat /></ProtectedRoute>} />

              <Route path="/" element={<AdminRoute><Dashboard /></AdminRoute>} />
              <Route path="/add" element={<AdminRoute><AddApplication /></AdminRoute>} />
              <Route path="/edit/:id" element={<AdminRoute><EditApplication /></AdminRoute>} />
              <Route path="/employee-search" element={<AdminRoute><EmployeeSearch /></AdminRoute>} />
              <Route path="/knowledge-base" element={<AdminRoute><KnowledgeBase /></AdminRoute>} />
              <Route path="/network-map" element={<AdminRoute><NetworkMap /></AdminRoute>} />
              <Route path="/statistics" element={<AdminRoute><Statistics /></AdminRoute>} />

              <Route path="/support" element={<Support />} />
              <Route path="*" element={<Navigate to={isEmployee ? '/employee' : '/'} replace />} />
            </Routes>
          </div>
        </div>
      </ApplicationsProvider>
    </Router>
  );
}

function Sidebar() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [newRequestsCount, setNewRequestsCount] = useState(() => {
    try {
      return Number(localStorage.getItem('cachedNewRequests') || 0);
    } catch {
      return 0;
    }
  });

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

    fetchNewRequests();
    const firstRetry = setTimeout(fetchNewRequests, 250);
    const secondRetry = setTimeout(fetchNewRequests, 1000);
    const interval = setInterval(fetchNewRequests, 5000);
    const markApplicationsViewed = (event) => {
      fetchNewRequests();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') fetchNewRequests();
    };

    window.addEventListener('focus', fetchNewRequests);
    document.addEventListener('visibilitychange', refreshOnVisible);
    window.addEventListener('applications:refresh', fetchNewRequests);
    window.addEventListener('applications:viewed', markApplicationsViewed);

    return () => {
      isCancelled = true;
      clearTimeout(firstRetry);
      clearTimeout(secondRetry);
      clearInterval(interval);
      window.removeEventListener('focus', fetchNewRequests);
      document.removeEventListener('visibilitychange', refreshOnVisible);
      window.removeEventListener('applications:refresh', fetchNewRequests);
      window.removeEventListener('applications:viewed', markApplicationsViewed);
    };
  }, [user?.name, user?.username]);

  const isActive = (path) => location.pathname === path;

  return (
    <>
      {isMobile && (
        <button className="mobile-menu-toggle" onClick={() => setIsMobileOpen(!isMobileOpen)}>
          ☰
        </button>
      )}

      {isMobileOpen && isMobile && <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />}

      <div className={`sidebar ${isMobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo"><span className="logo-mark">Н</span></div>
          <div className="sidebar-title">
            <h2>НИОХ Система</h2>
            <p>Учёт заявок</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Основная навигация">
          <ul>
            <li className="nav-group-title">Работа</li>
            <li className={isActive('/') ? 'nav-item active' : 'nav-item'}>
              <Link to="/" className="nav-link">
                <span className="nav-icon nav-icon--requests" aria-hidden="true" />
                <span className="nav-text">Заявки</span>
                {newRequestsCount > 0 && <span className="nav-badge">{newRequestsCount}</span>}
              </Link>
            </li>
            <li className={isActive('/add') ? 'nav-item active' : 'nav-item'}><Link to="/add" className="nav-link"><span className="nav-icon nav-icon--add" aria-hidden="true" /><span className="nav-text">Новая заявка</span></Link></li>
            <li className={isActive('/employee') ? 'nav-item active' : 'nav-item'}><Link to="/employee" className="nav-link"><span className="nav-icon nav-icon--chat" aria-hidden="true" /><span className="nav-text">Чат</span></Link></li>
            <li className="nav-group-title">Аналитика</li>
            <li className={isActive('/statistics') ? 'nav-item active' : 'nav-item'}><Link to="/statistics" className="nav-link"><span className="nav-icon nav-icon--chart" aria-hidden="true" /><span className="nav-text">Статистика</span></Link></li>
            <li className="nav-group-title">Настройки</li>
            <li className={isActive('/employee-search') ? 'nav-item active' : 'nav-item'}><Link to="/employee-search" className="nav-link"><span className="nav-icon nav-icon--people" aria-hidden="true" /><span className="nav-text">Справочник сотрудников</span></Link></li>
            <li className={isActive('/register') ? 'nav-item active' : 'nav-item'}><Link to="/register" className="nav-link"><span className="nav-icon nav-icon--account" aria-hidden="true" /><span className="nav-text">Управление доступом</span></Link></li>
            <li className={isActive('/knowledge-base') ? 'nav-item active' : 'nav-item'}><Link to="/knowledge-base" className="nav-link"><span className="nav-icon nav-icon--book" aria-hidden="true" /><span className="nav-text">База знаний</span></Link></li>
            <li className={isActive('/network-map') ? 'nav-item active' : 'nav-item'}><Link to="/network-map" className="nav-link"><span className="nav-icon nav-icon--network" aria-hidden="true" /><span className="nav-text">Диагностика сети</span></Link></li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar"><span className="user-icon">👤</span></div>
            <div className="user-details">
              <span className="user-name">{user?.name || 'Администратор'}</span>
              <span className="user-role">Администратор</span>
            </div>
          </div>
          <button onClick={() => { logout(); setIsMobileOpen(false); }} className="logout-btn">
            <span className="logout-icon">🚪</span>
            <span>Выход</span>
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
      {user?.role === 'admin' ? children : <Navigate to="/employee" replace />}
    </ProtectedRoute>
  );
}

export default App;
