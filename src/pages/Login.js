import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ADMIN_CREDENTIALS } from '../config/authConfig';
import './Login.css';

const Login = () => {
  const { login, isAuthenticated, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
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

      navigate(user?.role === 'employee' ? '/employee' : '/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, location, user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));

    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const loggedInUser = await login(formData.username, formData.password);
      navigate(loggedInUser.role === 'employee' ? '/employee' : '/', { replace: true });
    } catch (err) {
      setError(err.message || 'Произошла ошибка при входе. Попробуйте снова.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillAdminCredentials = (admin) => {
    setFormData({ username: admin.username, password: admin.password });
    if (error) setError('');
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-loading">
          <div className="spinner"></div>
          <p>{isLoading ? 'Проверка авторизации...' : 'Перенаправление...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13h-1v6l4.25 2.52.75-1.23-3.5-2.08V7z"/>
            </svg>
          </div>
          <h1>Добро пожаловать</h1>
          <p>Введите учетные данные</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="error-message">
              <span>⚠️</span>
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">Логин или Email</label>
            <input
              id="username"
              name="username"
              type="text"
              placeholder="admin_* или employee@email.ru"
              value={formData.username}
              onChange={handleChange}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Пароль</label>
            <div className="password-input-container">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Введите ваш пароль"
                value={formData.password}
                onChange={handleChange}
                disabled={isSubmitting}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="login-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <div className="button-spinner"></div>
                Вход...
              </>
            ) : (
              'Войти'
            )}
          </button>
        </form>

        <div className="demo-section">
          <p className="demo-title">Быстрый вход администраторов:</p>
          <div className="demo-buttons">
            {ADMIN_CREDENTIALS.map((admin) => (
              <button
                key={admin.username}
                type="button"
                className="demo-button admin"
                onClick={() => fillAdminCredentials(admin)}
                disabled={isSubmitting}
              >
                {admin.name}
              </button>
            ))}
          </div>
        </div>

        <div className="login-footer">
          <p>Нет аккаунта сотрудника? <Link to="/register">Зарегистрироваться</Link></p>
          <div className="support-link">
            <a href="/support">Нужна помощь?</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
