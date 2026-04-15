import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './Login.css';

const SUPPORT_CONTACTS = {
  internalPhone: '1-380',
  mobilePhone: '8 913 0080146',
  room: '309 НТК',
  email: 'povisok@nioch.nsc.ru'
};

const Login = () => {
  const { login, isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const from = location.state?.from?.pathname;
      if (from) {
        navigate(from, { replace: true });
        return;
      }
      navigate(user?.role === 'employee' || user?.role === 'manager' ? '/employee' : '/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, location, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const loggedInUser = await login(formData.username, formData.password);
      navigate(loggedInUser.role === 'employee' || loggedInUser.role === 'manager' ? '/employee' : '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Произошла ошибка при входе.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-loading"><div className="spinner"></div><p>{isLoading ? 'Проверка авторизации...' : 'Перенаправление...'}</p></div>
      </div>
    );
  }

  return (
    <div className="login-container login-container-v1">
      <div className="login-shell">
        <section className="login-hero">
          <p className="hero-location">Новосибирск · 2026</p>
          <h1>Цифровая платформа для заявок, сервиса и коммуникации сотрудников</h1>
          <p className="hero-description">
            Единое пространство для внутренних обращений:
            система создана для прозрачной и быстрой рабочей координации между подразделениями
            — и для ежедневного взаимодействия сотрудников в защищённой сети.
          </p>

          <div className="support-card">
            <h3>Техническая поддержка</h3>
            <div className="support-grid">
              <div><label>Внутренний</label><strong>{SUPPORT_CONTACTS.internalPhone}</strong></div>
              <div><label>Сотовый</label><strong>{SUPPORT_CONTACTS.mobilePhone}</strong></div>
              <div><label>Кабинет</label><strong>{SUPPORT_CONTACTS.room}</strong></div>
              <div><label>Email</label><a href={`mailto:${SUPPORT_CONTACTS.email}`}>{SUPPORT_CONTACTS.email}</a></div>
            </div>
          </div>
        </section>

        <section className="login-card">
          <div className="card-topline">⚗️ Secure Intranet Access</div>
          <h2>Вход в систему</h2>
          <p className="card-subtitle">Только для сотрудников локальной сети</p>

          <form onSubmit={handleSubmit} className="login-form">
            {error && <div className="error-message">{error}</div>}

            <label>
              Логин
              <input
                name="username"
                type="text"
                placeholder="employee@email"
                value={formData.username}
                onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                required
                disabled={isSubmitting}
              />
            </label>

            <label>
              Пароль
              <div className="password-input-container">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  required
                  disabled={isSubmitting}
                />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((prev) => !prev)}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </label>

            <button type="submit" className="login-button" disabled={isSubmitting}>{isSubmitting ? 'Вход...' : 'Войти'}</button>
          </form>

          <div className="card-footer">
            <p>Нет аккаунта сотрудника? <Link to="/register">Зарегистрироваться</Link></p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Login;
