import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import './Login.css';

const Login = () => {
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Если пользователь уже авторизован, перенаправляем его
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, location]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Очищаем ошибку при изменении поля
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      // В реальном проекте здесь будет запрос к API
      if (formData.username === 'admin' && formData.password === '123') {
        await login(formData.username);
        
        // Перенаправляем на предыдущую страницу или на главную
        const from = location.state?.from?.pathname || '/';
        navigate(from, { replace: true });
      } else {
        setError('Неверный логин или пароль');
      }
    } catch (err) {
      setError('Произошла ошибка при входе. Попробуйте снова.');
      console.error('Login error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoLogin = (role) => {
    const demoCredentials = {
      admin: { username: 'admin', password: '123' },
      user: { username: 'user', password: '123' },
      tech: { username: 'tech', password: '123' }
    };
    
    setFormData(demoCredentials[role]);
  };

  // Показываем загрузку пока проверяем аутентификацию
  if (isLoading) {
    return (
      <div className="login-container">
        <div className="login-loading">
          <div className="spinner"></div>
          <p>Проверка авторизации...</p>
        </div>
      </div>
    );
  }

  // Если уже авторизован, показываем загрузку перенаправления
  if (isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-loading">
          <div className="spinner"></div>
          <p>Перенаправление...</p>
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
          <p>Введите ваши учетные данные для входа</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="error-message">
              <span>⚠️</span>
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">Логин</label>
            <input
              id="username"
              name="username"
              type="text"
              placeholder="Введите ваш логин"
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
          <p className="demo-title">Демо доступ:</p>
          <div className="demo-buttons">
            <button 
              type="button" 
              className="demo-button admin"
              onClick={() => handleDemoLogin('admin')}
              disabled={isSubmitting}
            >
              Администратор
            </button>
            <button 
              type="button" 
              className="demo-button tech"
              onClick={() => handleDemoLogin('tech')}
              disabled={isSubmitting}
            >
              Техник
            </button>
            <button 
              type="button" 
              className="demo-button user"
              onClick={() => handleDemoLogin('user')}
              disabled={isSubmitting}
            >
              Пользователь
            </button>
          </div>
        </div>

        <div className="login-footer">
          <p>© 2025 ITS System. Все права защищены.</p>
          <div className="support-link">
            <a href="/support">Нужна помощь?</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;