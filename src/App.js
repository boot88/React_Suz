// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import Dashboard from './pages/Dashboard';
import AddApplication from './pages/AddApplication';
import EditApplication from './pages/EditApplicationsTable';
import Login from './pages/Login';
import EmployeeSearch from './pages/EmployeeSearch';
import { ApplicationsProvider } from './context/ApplicationsProvider';
import './App.css'; // Импортируем обновлённые стили

function App() {
  return (
    <Router>
      <ApplicationsProvider>
        <div className="app-container">
          <Sidebar />
          <div className="app-content">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/add" element={<ProtectedRoute><AddApplication /></ProtectedRoute>} />
              <Route path="/edit/:id" element={<ProtectedRoute><EditApplication /></ProtectedRoute>} />
              <Route path="/employee-search" element={<ProtectedRoute><EmployeeSearch /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to={useAuth().isAuthenticated ? '/' : '/login'} />} />
            </Routes>
          </div>
        </div>
      </ApplicationsProvider>
    </Router>
  );
}

// Компонент бокового меню
function Sidebar() {
  const { isAuthenticated, logout, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) return null;

  const isActive = (path) => location.pathname === path;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="logo-icon">⚗️</span>
        </div>
        <div className="sidebar-title">
          <h2>ИОХ Система</h2>
          <p>Учёт заявок</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <ul>
          <li className={isActive('/') ? 'nav-item active' : 'nav-item'}>
            <a href="/" className="nav-link">
              <span className="nav-icon">📊</span>
              <span className="nav-text">Дашборд</span>
            </a>
          </li>
          <li className={isActive('/add') ? 'nav-item active' : 'nav-item'}>
            <a href="/add" className="nav-link">
              <span className="nav-icon">➕</span>
              <span className="nav-text">Новая заявка</span>
            </a>
          </li>
          <li className={isActive('/edit/0') ? 'nav-item active' : 'nav-item'}>
            <a href="/edit/0" className="nav-link">
              <span className="nav-icon">✏️</span>
              <span className="nav-text">Редактирование</span>
            </a>
          </li>
          <li className={isActive('/employee-search') ? 'nav-item active' : 'nav-item'}>
            <a href="/employee-search" className="nav-link">
              <span className="nav-icon">👥</span>
              <span className="nav-text">Сотрудники</span>
            </a>
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
        <button onClick={logout} className="logout-btn">
          <span className="logout-icon">🚪</span>
          <span>Выход</span>
        </button>
      </div>
    </div>
  );
}

// Защита маршрута
function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return !isAuthenticated ? <Navigate to="/login" replace /> : children;
}

export default App;