import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './Login.css';
import loginSpectrumLines from '../assets/login-spectrum-lines.png';
import { API_BASE_URL } from '../utils/apiConfig';

const Login = () => {
  const { login, isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({ username: '', password: '' });
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
    const prefilledValue = (formData.username || '').trim().toLowerCase();
    const enteredLogin = window.prompt('Введите логин для восстановления пароля:', prefilledValue);
    const loginValue = (enteredLogin || '').trim().toLowerCase();

    if (!loginValue) {
      setError('Восстановление отменено: логин не указан');
      return;
    }

    setIsRecovering(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginValue })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось отправить новый пароль');
      window.alert(data.message || 'Запрос отправлен менеджерам');
    } catch (err) {
      setError(err.message || 'Ошибка восстановления пароля');
    } finally {
      setIsRecovering(false);
    }
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="jp-wrapper">
        <div className="login-loading">
          <div className="spinner"></div>
          <p>{isLoading ? 'Проверка авторизации...' : 'Перенаправление...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="jp-wrapper">
      <div className="jp-container">
        <header className="jp-header">
          <h1>Новосибирск · 2026</h1>
        </header>

        <main className="jp-content">
          <section className="jp-login-box">
            <h2>Вход</h2>
            <p className="jp-subtitle">Введите логин и пароль для доступа</p>

            <form className="jp-form" onSubmit={handleSubmit}>
              {error && <div className="error-message">{error}</div>}

              <div className="jp-field">
                <label htmlFor="username">Логин</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="Введите логин"
                  value={formData.username}
                  onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                  required
                  disabled={isSubmitting}
                />
              </div>

              <div className="jp-field">
                <label htmlFor="password">Пароль</label>
                <div className="jp-password-wrapper">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Введите пароль"
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    required
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="jp-password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    disabled={isSubmitting}
                  >
                    {showPassword ? 'Скрыть' : 'Показать'}
                  </button>
                </div>
              </div>

              <button type="submit" className="jp-button" disabled={isSubmitting || isRecovering}>
                {isSubmitting ? 'Вход...' : 'Войти'}
              </button>
            </form>

            <div className="jp-login-pattern-wrap" aria-hidden="true">
              <img className="jp-login-pattern" src={loginSpectrumLines} alt="" />
            </div>

            <div className="jp-footer">
              <button type="button" className="jp-link-button" onClick={handleForgotPassword} disabled={isSubmitting || isRecovering}>
                {isRecovering ? 'Отправка...' : 'Забыли пароль?'}
              </button>
              <p>Нет аккаунта сотрудника? <Link to="/register">Зарегистрироваться</Link></p>
            </div>
          </section>
        </main>

        <footer className="jp-page-footer">© 2026 Внутренний портал</footer>
      </div>
    </div>
  );
};

export default Login;
