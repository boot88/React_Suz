import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import './Login.css';
import loginSpectrumLines from '../assets/login-spectrum-lines.png';
import { API_BASE_URL } from '../utils/apiConfig';


const LOGIN_LANGUAGE_KEY = 'loginLanguage';
const LOGIN_LABELS = {
  en: {
    back: '← back', adminEntry: 'administrator login', adminChip: 'Control panel', title: 'Login', subtitle: 'Enter login and password',
    missing: 'Enter login and password.', adminOnly: 'This login is for administrators. Employees should use the regular login.', employeeOnly: 'Administrators should use the separate login.', genericError: 'Login error.',
    recoveryNeedLogin: 'Enter a login to request password recovery.', recoverySendFail: 'Could not send a new password', recoverySent: 'Request sent to responsible managers.', recoveryError: 'Password recovery error',
    loadingAuth: 'Checking authorization...', redirect: 'Redirecting...', warning: 'Check keyboard layout and password. After several wrong attempts login is temporarily blocked.',
    usernameLabel: 'Surname / login', usernamePlaceholder: 'Start typing a surname', showEmployees: 'Show employee list', departmentMissing: 'department —', room: 'room', phoneMissing: 'phone —',
    password: 'Password', passwordPlaceholder: 'Enter password', hidePassword: 'Hide password', showPassword: 'Show password', hide: 'Hide', show: 'Show', caps: 'Caps Lock is on.', checking: 'Checking...', signIn: 'Sign in',
    register: 'Employee registration', sending: 'Sending...', forgot: 'Forgot password?', closeRecovery: 'Close recovery window', recoveryTitle: 'Access recovery', recoveryText: 'Enter the employee login. A new temporary password will be sent to responsible managers in the service chat.', recoveryLogin: 'Employee login', sendRequest: 'Send request'
  },
  ru: {
    back: '← назад', adminEntry: 'вход для администратора', adminChip: 'Панель управления', title: 'Вход', subtitle: 'Введите логин и пароль',
    missing: 'Введите логин и пароль.', adminOnly: 'Это вход для администратора. Для сотрудника используйте обычный вход.', employeeOnly: 'Для администратора используйте отдельный вход.', genericError: 'Произошла ошибка при входе.',
    recoveryNeedLogin: 'Укажите логин, чтобы отправить запрос на восстановление.', recoverySendFail: 'Не удалось отправить новый пароль', recoverySent: 'Запрос отправлен ответственным сотрудникам.', recoveryError: 'Ошибка восстановления пароля',
    loadingAuth: 'Проверка авторизации...', redirect: 'Перенаправление...', warning: 'Проверьте раскладку и правильность пароля. После нескольких неверных попыток вход временно блокируется.',
    usernameLabel: 'Фамилия / логин', usernamePlaceholder: 'Начните вводить фамилию', showEmployees: 'Показать список сотрудников', departmentMissing: 'отдел —', room: 'каб', phoneMissing: 'тел. —',
    password: 'Пароль', passwordPlaceholder: 'Введите пароль', hidePassword: 'Скрыть пароль', showPassword: 'Показать пароль', hide: 'Скрыть', show: 'Показать', caps: 'Включён Caps Lock.', checking: 'Проверяем...', signIn: 'Войти',
    register: 'Регистрация сотрудника', sending: 'Отправка...', forgot: 'Забыли пароль?', closeRecovery: 'Закрыть окно восстановления', recoveryTitle: 'Восстановление доступа', recoveryText: 'Укажите логин сотрудника. Новый временный пароль будет передан ответственным менеджерам в служебном чате.', recoveryLogin: 'Логин сотрудника', sendRequest: 'Отправить запрос'
  }
};


const formatSuggestionName = (value = '') => String(value || '')
  .trim()
  .split(/\s+/)
  .map((part, index) => {
    if (!part) return part;
    if (index > 0 && part.includes('.')) return part.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  })
  .join(' ');

const normalizeLoginValue = (value = '') => value.trim().toLowerCase();

const Login = ({ mode = 'employee' }) => {
  const { login, logout, isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminMode = mode === 'admin';
  const [language, setLanguage] = useState(() => localStorage.getItem(LOGIN_LANGUAGE_KEY) || 'en');
  const t = (key) => LOGIN_LABELS[language]?.[key] || LOGIN_LABELS.en[key] || key;
  const changeLanguage = (nextLanguage) => {
    localStorage.setItem(LOGIN_LANGUAGE_KEY, nextLanguage);
    setLanguage(nextLanguage);
  };

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
  const [loginSuggestions, setLoginSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [selectedLogin, setSelectedLogin] = useState('');
  const defaultLoginAppliedRef = useRef(false);
  const loginFieldRef = useRef(null);


  useEffect(() => {
    const query = showAllSuggestions ? '' : formData.username.trim();
    const role = isAdminMode ? 'admin' : 'employee';
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/login-suggestions?role=${role}&query=${encodeURIComponent(query)}`);
        if (!response.ok) return;
        const data = await response.json();
        const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setLoginSuggestions(suggestions);

        if (!query && !defaultLoginAppliedRef.current && suggestions[0]?.login) {
          defaultLoginAppliedRef.current = true;
          setSelectedLogin(suggestions[0].login || '');
          setFormData((prev) => prev.username ? prev : { ...prev, username: formatSuggestionName(suggestions[0].display_name || suggestions[0].full_name || suggestions[0].login) });
        }
      } catch {
        setLoginSuggestions([]);
      }
    }, query ? 180 : 0);

    return () => clearTimeout(timeout);
  }, [formData.username, isAdminMode, showAllSuggestions]);


  useEffect(() => {
    const handleDocumentPointerDown = (event) => {
      if (!loginFieldRef.current || loginFieldRef.current.contains(event.target)) return;
      setSuggestionsOpen(false);
      setShowAllSuggestions(false);
    };

    document.addEventListener('mousedown', handleDocumentPointerDown);
    return () => document.removeEventListener('mousedown', handleDocumentPointerDown);
  }, []);

  const applyLoginSuggestion = (suggestion) => {
    setSelectedLogin(suggestion.login || '');
    setFormData((prev) => ({ ...prev, username: formatSuggestionName(suggestion.display_name || suggestion.full_name || suggestion.login || prev.username) }));
    setSuggestionsOpen(false);
    setShowAllSuggestions(false);
  };

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
    const username = selectedLogin || normalizeLoginValue(formData.username);

    if (!username || !formData.password) {
      setError(t('missing'));
      return;
    }

    setError('');
    setRecoveryError('');
    setRecoveryMessage('');
    setIsSubmitting(true);

    try {
      const loggedInUser = await login(username, formData.password, { scope: isAdminMode ? 'admin' : 'employee' });
      const isAdminUser = loggedInUser.role === 'admin';
      const isEmployeeUser = loggedInUser.role === 'employee' || loggedInUser.role === 'manager';

      if (isAdminMode && !isAdminUser) {
        logout();
        setFailedAttempts((prev) => prev + 1);
        setError(t('adminOnly'));
        return;
      }

      if (!isAdminMode && !isEmployeeUser) {
        logout();
        setFailedAttempts((prev) => prev + 1);
        setError(t('employeeOnly'));
        return;
      }

      setFailedAttempts(0);
      const from = location.state?.from?.pathname;
      navigate(from || (isAdminUser ? '/' : '/employee'), { replace: true });
    } catch (err) {
      setFailedAttempts((prev) => prev + 1);
      setError(err.message || t('genericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRecoveryPanel = () => {
    setRecoveryLogin(formatSuggestionName(formData.username));
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
      setRecoveryError(t('recoveryNeedLogin'));
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
      if (!response.ok) throw new Error(data.message || t('recoverySendFail'));
      setRecoveryMessage(data.message || t('recoverySent'));
      setRecoveryLogin(loginValue);
      setIsRecoveryOpen(false);
    } catch (err) {
      setRecoveryError(err.message || t('recoveryError'));
    } finally {
      setIsRecovering(false);
    }
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="jp-wrapper">
        <div className="login-loading">
          <div className="spinner"></div>
          <p>{isLoading ? t('loadingAuth') : t('redirect')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`jp-wrapper ${isAdminMode ? 'jp-wrapper--admin' : 'jp-wrapper--employee'}`}>
      <Link className="jp-corner-link" to={isAdminMode ? '/login' : '/admin'}>
        {isAdminMode ? t('back') : t('adminEntry')}
      </Link>

      <div className="jp-login-shell">
        <main className="jp-content">
          <section className="jp-login-box" aria-labelledby="login-title">
            <div className="jp-card-topline" />
            {isAdminMode && <span className="jp-chip">{t('adminChip')}</span>}
            <h1 id="login-title">{t('title')}</h1>
            <p className="jp-subtitle">{t('subtitle')}</p>

            <form className="jp-form" onSubmit={handleSubmit} noValidate>
              {error && <div className="error-message" role="alert">{error}</div>}
              {recoveryMessage && <div className="success-message" role="status">{recoveryMessage}</div>}
              {failedAttempts >= 2 && (
                <div className="warning-message" role="status">
                  {t('warning')}
                </div>
              )}

              <div className="jp-field" ref={loginFieldRef}>
                <label htmlFor="username">{t('usernameLabel')}</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder={t('usernamePlaceholder')}
                  value={formData.username}
                  onChange={(e) => { setSelectedLogin(''); setShowAllSuggestions(false); setFormData((prev) => ({ ...prev, username: e.target.value })); setSuggestionsOpen(true); }}
                  onFocus={() => setSuggestionsOpen(true)}
                  autoComplete="off"
                  spellCheck="false"
                  required
                  disabled={isSubmitting}
                />
                <button type="button" className="login-suggestions-toggle" onClick={() => { setShowAllSuggestions(true); setSuggestionsOpen((prev) => !prev); }} disabled={isSubmitting} aria-label={t('showEmployees')}>
                  ▾
                </button>
                {suggestionsOpen && loginSuggestions.length > 0 && (
                  <div className="login-suggestions">
                    {loginSuggestions.map((suggestion) => (
                      <button key={suggestion.id || suggestion.login} type="button" onMouseDown={(event) => { event.preventDefault(); applyLoginSuggestion(suggestion); }}>
                        <strong>{formatSuggestionName(suggestion.display_name || suggestion.full_name || suggestion.login)}</strong>
                        {!isAdminMode && <span>{suggestion.department || t('departmentMissing')} · {t('room')}. {suggestion.room || '—'} · {suggestion.phone || t('phoneMissing')}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="jp-field">
                <label htmlFor="password">{t('password')}</label>
                <div className="jp-password-wrapper">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('passwordPlaceholder')}
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
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  >
                    {showPassword ? t('hide') : t('show')}
                  </button>
                </div>
                {capsLockOn && <p className="jp-caps-warning">{t('caps')}</p>}
              </div>

              <button type="submit" className="jp-button" disabled={isSubmitting || isRecovering}>
                {isSubmitting ? t('checking') : t('signIn')}
              </button>
            </form>

            {!isAdminMode && (
              <div className="jp-login-pattern-wrap" aria-hidden="true">
                <img className="jp-login-pattern" src={loginSpectrumLines} alt="" />
              </div>
            )}

            {!isAdminMode && (
              <div className="jp-footer">
                <Link to="/register">{t('register')}</Link>
                <button type="button" className="jp-link-button" onClick={openRecoveryPanel} disabled={isSubmitting || isRecovering}>
                  {isRecovering ? t('sending') : t('forgot')}
                </button>
              </div>
            )}
          </section>
        </main>
      </div>

      <div className="jp-language-switch" aria-label="Language switch">
        <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => changeLanguage('en')}>🇬🇧 ENG</button>
        <button type="button" className={language === 'ru' ? 'active' : ''} onClick={() => changeLanguage('ru')}>🇷🇺 RUS</button>
      </div>

      {isRecoveryOpen && (
        <div className="jp-modal-backdrop" role="presentation" onMouseDown={closeRecoveryPanel}>
          <section className="jp-recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="jp-modal-close" onClick={closeRecoveryPanel} disabled={isRecovering} aria-label={t('closeRecovery')}>
              ×
            </button>
            <h2 id="recovery-title">{t('recoveryTitle')}</h2>
            <p>{t('recoveryText')}</p>
            <form className="jp-recovery-form" onSubmit={handleForgotPassword}>
              <label htmlFor="recovery-login">{t('recoveryLogin')}</label>
              <input
                id="recovery-login"
                value={recoveryLogin}
                onChange={(e) => { setRecoveryLogin(e.target.value); if (recoveryError) setRecoveryError(''); }}
                placeholder={t('usernamePlaceholder')}
                autoComplete="username"
                autoFocus
                disabled={isRecovering}
              />
              {recoveryError && <div className="error-message recovery-error" role="alert">{recoveryError}</div>}
              <button type="submit" className="jp-button" disabled={isRecovering}>{isRecovering ? t('sending') : t('sendRequest')}</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};

export default Login;
