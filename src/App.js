// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import AddApplication from './pages/AddApplication';
import EditApplication from './pages/EditApplicationsTable';
import Login from './pages/Login';
import EmployeeSearch from './pages/EmployeeSearch';
import KnowledgeBase from './pages/KnowledgeBase'; // Новый компонент
import { ApplicationsProvider } from './context/ApplicationsProvider';
import './App.css';
import { Link } from 'react-router-dom';
import Support from './components/Support';
import Statistics from './pages/Statistics';



function App() {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Проверка авторизации...</p>
      </div>
    );
  }
  
  return (
    <Router>
      <ApplicationsProvider>
        <div className="app-container">
          {isAuthenticated && <Sidebar />}
          <div className={`app-content ${isAuthenticated ? 'app-content--with-sidebar' : ''}`}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/add" element={<ProtectedRoute><AddApplication /></ProtectedRoute>} />
              <Route path="/edit/:id" element={<ProtectedRoute><EditApplication /></ProtectedRoute>} />
              <Route path="/employee-search" element={<ProtectedRoute><EmployeeSearch /></ProtectedRoute>} />
              <Route path="/knowledge-base" element={<ProtectedRoute><KnowledgeBase /></ProtectedRoute>} /> {/* Новый маршрут */}
			  <Route path="/statistics" element={<ProtectedRoute><Statistics /></ProtectedRoute>} />
              <Route path="/support" element={<Support />} />
              <Route path="*" element={<Navigate to="/" replace />} />
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

  const handleOverlayClick = () => {
    setIsMobileOpen(false);
  };

  const isActive = (path) => location.pathname === path;

  return (
    <>
      {isMobile && (
        <button 
          className="mobile-menu-toggle"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
        >
          ☰
        </button>
      )}

      {isMobileOpen && isMobile && (
        <div 
          className="sidebar-overlay"
          onClick={handleOverlayClick}
        />
      )}

      <div className={`sidebar ${isMobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span className="logo-icon">⚗️</span>
          </div>
          <div className="sidebar-title">
            <h2>НИОХ Система</h2>
            <p>Учёт заявок</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <ul>
            <li className={isActive('/') ? 'nav-item active' : 'nav-item'}>
              <Link to="/" className="nav-link" onClick={() => setIsMobileOpen(false)}>
                <span className="nav-icon">📊</span>
                <span className="nav-text">Дашборд</span>
              </Link>
            </li>
            <li className={isActive('/add') ? 'nav-item active' : 'nav-item'}>
              <Link to="/add" className="nav-link" onClick={() => setIsMobileOpen(false)}>
                <span className="nav-icon">➕</span>
                <span className="nav-text">Новая заявка</span>
              </Link>
            </li>
            <li className={isActive('/edit/0') ? 'nav-item active' : 'nav-item'}>
              <Link to="/edit/0" className="nav-link" onClick={() => setIsMobileOpen(false)}>
                <span className="nav-icon">✏️</span>
                <span className="nav-text">Редактирование</span>
              </Link>
            </li>
            
			
			 <li className={isActive('/edit/0') ? 'nav-item active' : 'nav-item'}>
              <Link to="/statistics" className="nav-link" onClick={() => setIsMobileOpen(false)}>
                <span className="nav-icon">📊</span>
                <span className="nav-text">Статистика</span>
              </Link>
            </li>
			
			
			<li className={isActive('/employee-search') ? 'nav-item active' : 'nav-item'}>
              <Link to="/employee-search" className="nav-link" onClick={() => setIsMobileOpen(false)}>
                <span className="nav-icon">👥</span>
                <span className="nav-text">Сотрудники</span>
              </Link>
            </li>
			
			
            {/* Новый пункт меню - База Знаний */}
            <li className={isActive('/knowledge-base') ? 'nav-item active' : 'nav-item'}>
              <Link to="/knowledge-base" className="nav-link" onClick={() => setIsMobileOpen(false)}>
                <span className="nav-icon">📚</span>
                <span className="nav-text">База Знаний</span>
              </Link>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              <span className="user-icon">👤</span>
            </div>
            <div className="user-details">
              <span className="user-name">{user?.name || 'Администратор'}</span>
              <span className="user-role">{user?.role || 'Научный отдел'}</span>
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
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Проверка авторизации...</p>
      </div>
    );
  }
  
  return !isAuthenticated ? <Navigate to="/login" replace /> : children;
}

export default App;