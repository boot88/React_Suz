import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './Login.css';
import loginSpectrumLines from '../assets/login-spectrum-lines.png';
import { API_BASE_URL } from '../utils/apiConfig';

const LOGIN_AUDIENCES = [
  {
    title: 'Сотрудники',
    text: 'чат, лента, профиль и подача заявок в техническую службу',
    accent: '01'
  },
  {
    title: 'Администраторы',
    text: 'панель заявок, статусы работ, исполнители и отчётность',
    accent: '02'
  }
];

const SECURITY_NOTES = [
  'Работает только во внутреннем контуре института',
  'Не передавайте пароль коллегам и не сохраняйте его на общих ПК',
  'После 7 неверных попыток вход временно блокируется'
];

const normalizeLoginValue = (value = '') => value.trim().toLowerCase();

const Login = () => {
  const { login, isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [recoveryLogin, setRecoveryLogin] = useState('');
  const [capsLockOn, setCapsLockOn] = useState(false);

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
    const username = normalizeLoginValue(formData.username);

    if (!username || !formData.password) {
      setError('Введите логин и пароль.');
      return;
    }

    setError('');
    setRecoveryMessage('');
    setIsSubmitting(true);

    try {
      const loggedInUser = await login(username, formData.password);
      navigate(loggedInUser.role === 'employee' || loggedInUser.role === 'manager' ? '/employee' : '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Произошла ошибка при входе.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRecoveryPanel = () => {
    setRecoveryLogin(normalizeLoginValue(formData.username));
    setRecoveryMessage('');
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
      setError('Укажите логин, чтобы отправить запрос на восстановление.');
      return;
    }

    setIsRecovering(true);
    setError('');
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
      <div className="jp-orb jp-orb-one" aria-hidden="true" />
      <div className="jp-orb jp-orb-two" aria-hidden="true" />

      <div className="jp-container">
        <header className="jp-header">
          <div>
            <span className="jp-eyebrow">Закрытый внутренний портал</span>
            <h1>НИОХ СО РАН</h1>
            <p>Новосибирский институт органической химии им. Н. Н. Ворожцова</p>
          </div>
          <a className="jp-official-link" href="https://web3.nioch.nsc.ru/nioch/index.php/ru/" target="_blank" rel="noreferrer">
            Официальный сайт
          </a>
        </header>

        <main className="jp-content">
          <section className="jp-login-box" aria-labelledby="login-title">
            <div className="jp-card-topline" />
            <span className="jp-chip">LAN · служебный доступ</span>
            <h2 id="login-title">Вход в систему</h2>
            <p className="jp-subtitle">Один вход для чата сотрудников, заявок и панели администратора.</p>

            <form className="jp-form" onSubmit={handleSubmit} noValidate>
              {error && <div className="error-message" role="alert">{error}</div>}
              {recoveryMessage && <div className="success-message" role="status">{recoveryMessage}</div>}

              <div className="jp-field">
                <label htmlFor="username">Логин</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="например: ivanov или ivanov@nioch"
                  value={formData.username}
                  onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                  autoComplete="username"
                  inputMode="email"
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
                {capsLockOn && <p className="jp-caps-warning">Включён Caps Lock — проверьте раскладку и регистр.</p>}
              </div>

              <button type="submit" className="jp-button" disabled={isSubmitting || isRecovering}>
                {isSubmitting ? 'Проверяем доступ...' : 'Войти в портал'}
              </button>
            </form>

            <div className="jp-login-pattern-wrap" aria-hidden="true">
              <img className="jp-login-pattern" src={loginSpectrumLines} alt="" />
            </div>

            <div className="jp-footer">
              <button type="button" className="jp-link-button" onClick={openRecoveryPanel} disabled={isSubmitting || isRecovering}>
                {isRecovering ? 'Отправка...' : 'Забыли пароль?'}
              </button>
              <p>Нет аккаунта сотрудника? <Link to="/register">Зарегистрироваться</Link></p>
            </div>
          </section>

          <aside className="jp-info-panel" aria-label="Информация о портале">
            <div className="jp-status-card">
              <span className="jp-status-dot" />
              <div>
                <strong>Контур доступен</strong>
                <p>Авторизация ведёт сотрудника в чат, администратора — в панель заявок.</p>
              </div>
            </div>

            <div className="jp-audience-grid">
              {LOGIN_AUDIENCES.map((item) => (
                <article className="jp-audience-card" key={item.title}>
                  <span>{item.accent}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>

            <div className="jp-security-card">
              <h3>Безопасность входа</h3>
              <ul>
                {SECURITY_NOTES.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          </aside>
        </main>

        <footer className="jp-page-footer">© 2026 Внутренний портал НИОХ СО РАН</footer>
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
                onChange={(e) => setRecoveryLogin(e.target.value)}
                placeholder="ivanov или ivanov@nioch"
                autoComplete="username"
                autoFocus
                disabled={isRecovering}
              />
              <button type="submit" className="jp-button" disabled={isRecovering}>{isRecovering ? 'Отправляем...' : 'Отправить запрос'}</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default Login;
