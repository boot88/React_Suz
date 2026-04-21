import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './Login.css';
import { API_BASE_URL } from '../utils/apiConfig';

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
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
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


  const handleForgotPassword = async () => {
    const emailValue = (recoveryEmail || '').trim().toLowerCase();
    if (!emailValue) {
      setError('Введите email в поле "Почта для восстановления"');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setError('Введите корректный email для восстановления');
      return;
    }

    setIsRecovering(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Не удалось отправить новый пароль');
      }
      setError('');
      window.alert(data.message || `Новый пароль отправлен на ${emailValue}`);
    } catch (err) {
      setError(err.message || 'Ошибка восстановления пароля');
    } finally {
      setIsRecovering(false);
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
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setFormData((prev) => ({ ...prev, username: nextValue }));
                  setRecoveryEmail(nextValue);
                }}
                required
                disabled={isSubmitting}
              />
            </label>

            <label>
              Почта для восстановления *
              <input
                name="recoveryEmail"
                type="email"
                placeholder="employee@email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                disabled={isSubmitting || isRecovering}
                required
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
                <button type="button" className="password-toggle" onClick={() => setShowPassword((prev) => !prev)} aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 3l18 18-1.4 1.4-3.1-3.1A11.9 11.9 0 0 1 12 20C6.5 20 2.1 16.5.4 12c.8-2 2.2-3.8 4-5.3L1.6 4.4 3 3zm6.5 6.5a3.5 3.5 0 0 0 5 5l-5-5zM12 4c5.5 0 9.9 3.5 11.6 8a12.2 12.2 0 0 1-5.4 6.4l-2-2A3.5 3.5 0 0 0 9.6 9.8l-2-2A12.3 12.3 0 0 1 12 4z" fill="currentColor"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5c5.5 0 9.9 3.5 11.6 7-1.7 3.5-6.1 7-11.6 7S2.1 15.5.4 12C2.1 8.5 6.5 5 12 5zm0 2C7.8 7 4.4 9.5 2.7 12 4.4 14.5 7.8 17 12 17s7.6-2.5 9.3-5C19.6 9.5 16.2 7 12 7zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" fill="currentColor"/>
                    </svg>
                  )}
                </button>
              </div>
            </label>

            <button type="submit" className="login-button" disabled={isSubmitting || isRecovering}>{isSubmitting ? 'Вход...' : 'Войти'}</button>
            <button type="button" className="forgot-button" onClick={handleForgotPassword} disabled={isSubmitting || isRecovering}>
              {isRecovering ? 'Отправка...' : 'Забыли пароль? Отправить новый на почту'}
            </button>
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
