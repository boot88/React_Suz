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
import EmployeeChat from './pages/EmployeeChat';
import { ApplicationsProvider } from './context/ApplicationsProvider';
import './App.css';
import Support from './components/Support';
import Statistics from './pages/Statistics';
import { LAN_HOST } from './utils/apiConfig';

function App() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    const target = `http://${LAN_HOST}:3000${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(target);
    return null;
  }

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Проверка авторизации...</p>
      </div>
    );
  }

  const isEmployee = user?.role === 'employee';

  return (
    <Router>
      <ApplicationsProvider>
        <div className="app-container">
          {isAuthenticated && !isEmployee && <Sidebar />}
          <div className={`app-content ${isAuthenticated && !isEmployee ? 'app-content--with-sidebar' : ''}`}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />

              <Route path="/employee" element={<ProtectedRoute><EmployeeChat /></ProtectedRoute>} />

              <Route path="/" element={<AdminRoute><Dashboard /></AdminRoute>} />
              <Route path="/add" element={<AdminRoute><AddApplication /></AdminRoute>} />
              <Route path="/edit/:id" element={<AdminRoute><EditApplication /></AdminRoute>} />
              <Route path="/employee-search" element={<AdminRoute><EmployeeSearch /></AdminRoute>} />
              <Route path="/knowledge-base" element={<AdminRoute><KnowledgeBase /></AdminRoute>} />
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

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      if (window.innerWidth > 768) {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
          <div className="sidebar-logo"><span className="logo-icon">⚗️</span></div>
          <div className="sidebar-title">
            <h2>НИОХ Система</h2>
            <p>Учёт заявок</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <ul>
            <li className={isActive('/') ? 'nav-item active' : 'nav-item'}><Link to="/" className="nav-link"><span className="nav-icon">📊</span><span className="nav-text">Дашборд</span></Link></li>
            <li className={isActive('/add') ? 'nav-item active' : 'nav-item'}><Link to="/add" className="nav-link"><span className="nav-icon">➕</span><span className="nav-text">Новая заявка</span></Link></li>
            <li className={isActive('/edit/0') ? 'nav-item active' : 'nav-item'}><Link to="/edit/0" className="nav-link"><span className="nav-icon">✏️</span><span className="nav-text">Редактирование</span></Link></li>
            <li className={isActive('/statistics') ? 'nav-item active' : 'nav-item'}><Link to="/statistics" className="nav-link"><span className="nav-icon">📊</span><span className="nav-text">Статистика</span></Link></li>
            <li className={isActive('/employee-search') ? 'nav-item active' : 'nav-item'}><Link to="/employee-search" className="nav-link"><span className="nav-icon">👥</span><span className="nav-text">Сотрудники</span></Link></li>
            <li className={isActive('/knowledge-base') ? 'nav-item active' : 'nav-item'}><Link to="/knowledge-base" className="nav-link"><span className="nav-icon">📚</span><span className="nav-text">База Знаний</span></Link></li>
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

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="app-loading"><div className="spinner"></div><p>Проверка авторизации...</p></div>;
  }

  return !isAuthenticated ? <Navigate to="/login" replace /> : children;
}

function AdminRoute({ children }) {
  const { user } = useAuth();

  return (
    <ProtectedRoute>
      {user?.role === 'admin' ? children : <Navigate to="/employee" replace />}
    </ProtectedRoute>
  );
}

export default App;
