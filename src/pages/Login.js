import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './Login.css';
import loginSpectrumLines from '../assets/login-spectrum-lines.png';
import { API_BASE_URL } from '../utils/apiConfig';

const normalizeLoginValue = (value = '') => value.trim().toLowerCase();

const Login = ({ mode = 'employee' }) => {
  const { login, logout, isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminMode = mode === 'admin';

  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [recoveryLogin, setRecoveryLogin] = useState('');
  const [capsLockOn, setCapsLockOn] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      if (user?.role === 'admin') {
        navigate('/', { replace: true });
        return;
      }
      navigate('/employee', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = normalizeLoginValue(formData.username);

    if (!username || !formData.password) {
      setError('Введите логин и пароль.');
      return;
    }

    setError('');
    setRecoveryError('');
    setRecoveryMessage('');
    setIsSubmitting(true);

    try {
      const loggedInUser = await login(username, formData.password);
      const isAdminUser = loggedInUser.role === 'admin';
      const isEmployeeUser = loggedInUser.role === 'employee' || loggedInUser.role === 'manager';

      if (isAdminMode && !isAdminUser) {
        logout();
        setFailedAttempts((prev) => prev + 1);
        setError('Это вход для администратора. Для сотрудника используйте обычный вход.');
        return;
      }

      if (!isAdminMode && !isEmployeeUser) {
        logout();
        setFailedAttempts((prev) => prev + 1);
        setError('Для администратора используйте отдельный вход.');
        return;
      }

      setFailedAttempts(0);
      const from = location.state?.from?.pathname;
      navigate(from || (isAdminUser ? '/' : '/employee'), { replace: true });
    } catch (err) {
      setFailedAttempts((prev) => prev + 1);
      setError(err.message || 'Произошла ошибка при входе.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRecoveryPanel = () => {
    setRecoveryLogin(normalizeLoginValue(formData.username));
    setRecoveryMessage('');
    setRecoveryError('');
    setError('');
    setIsRecoveryOpen(true);
  };

  const closeRecoveryPanel = () => {
    if (isRecovering) return;
    setIsRecoveryOpen(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    const loginValue = normalizeLoginValue(recoveryLogin || formData.username);

    if (!loginValue) {
      setRecoveryError('Укажите логин, чтобы отправить запрос на восстановление.');
      return;
    }

    setIsRecovering(true);
    setError('');
    setRecoveryError('');
    setRecoveryMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginValue })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Не удалось отправить новый пароль');
      setRecoveryMessage(data.message || 'Запрос отправлен ответственным сотрудникам.');
      setRecoveryLogin(loginValue);
      setIsRecoveryOpen(false);
    } catch (err) {
      setRecoveryError(err.message || 'Ошибка восстановления пароля');
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
    <div className={`jp-wrapper ${isAdminMode ? 'jp-wrapper--admin' : 'jp-wrapper--employee'}`}>
      <Link className="jp-corner-link" to={isAdminMode ? '/login' : '/admin'}>
        {isAdminMode ? '← назад' : 'вход для администратора'}
      </Link>

      <div className="jp-login-shell">
        <main className="jp-content">
          <section className="jp-login-box" aria-labelledby="login-title">
            <div className="jp-card-topline" />
            {isAdminMode && <span className="jp-chip">Панель управления</span>}
            <h1 id="login-title">Вход</h1>
            <p className="jp-subtitle">Введите логин и пароль</p>

            <form className="jp-form" onSubmit={handleSubmit} noValidate>
              {error && <div className="error-message" role="alert">{error}</div>}
              {recoveryMessage && <div className="success-message" role="status">{recoveryMessage}</div>}
              {failedAttempts >= 2 && (
                <div className="warning-message" role="status">
                  Проверьте раскладку и правильность пароля. После нескольких неверных попыток вход временно блокируется.
                </div>
              )}

              <div className="jp-field">
                <label htmlFor="username">Логин</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="Введите логин"
                  value={formData.username}
                  onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                  autoComplete="username"
                  spellCheck="false"
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
                    onKeyUp={(e) => setCapsLockOn(Boolean(e.getModifierState?.('CapsLock')))}
                    onBlur={() => setCapsLockOn(false)}
                    autoComplete="current-password"
                    required
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="jp-password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    disabled={isSubmitting}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    {showPassword ? 'Скрыть' : 'Показать'}
                  </button>
                </div>
                {capsLockOn && <p className="jp-caps-warning">Включён Caps Lock.</p>}
              </div>

              <button type="submit" className="jp-button" disabled={isSubmitting || isRecovering}>
                {isSubmitting ? 'Проверяем...' : 'Войти'}
              </button>
            </form>

            {!isAdminMode && (
              <div className="jp-login-pattern-wrap" aria-hidden="true">
                <img className="jp-login-pattern" src={loginSpectrumLines} alt="" />
              </div>
            )}

            {!isAdminMode && (
              <div className="jp-footer">
                <Link to="/register">Регистрация сотрудника</Link>
                <button type="button" className="jp-link-button" onClick={openRecoveryPanel} disabled={isSubmitting || isRecovering}>
                  {isRecovering ? 'Отправка...' : 'Забыли пароль?'}
                </button>
              </div>
            )}
          </section>
        </main>
      </div>

      {isRecoveryOpen && (
        <div className="jp-modal-backdrop" role="presentation" onMouseDown={closeRecoveryPanel}>
          <section className="jp-recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="jp-modal-close" onClick={closeRecoveryPanel} disabled={isRecovering} aria-label="Закрыть окно восстановления">
              ×
            </button>
            <h2 id="recovery-title">Восстановление доступа</h2>
            <p>Укажите логин сотрудника. Новый временный пароль будет передан ответственным менеджерам в служебном чате.</p>
            <form className="jp-recovery-form" onSubmit={handleForgotPassword}>
              <label htmlFor="recovery-login">Логин сотрудника</label>
              <input
                id="recovery-login"
                value={recoveryLogin}
                onChange={(e) => { setRecoveryLogin(e.target.value); if (recoveryError) setRecoveryError(''); }}
                placeholder="Введите логин"
                autoComplete="username"
                autoFocus
                disabled={isRecovering}
              />
              {recoveryError && <div className="error-message recovery-error" role="alert">{recoveryError}</div>}
              <button type="submit" className="jp-button" disabled={isRecovering}>{isRecovering ? 'Отправляем...' : 'Отправить запрос'}</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default Login;
