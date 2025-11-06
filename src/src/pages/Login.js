import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import './Login.css';

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    const res = await login(formData.username, formData.password);
    setIsSubmitting(false);
    if (res.success) {
      const from = location.state?.from?.pathname || '/';
      navigate(from, { replace: true });
    } else {
      setError(res.message || 'Неверный логин или пароль');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h2>Вход в систему</h2>
        <form onSubmit={handleSubmit} className="login-form">
          <label>Логин</label>
          <input name="username" value={formData.username} onChange={handleChange} required />
          <label>Пароль</label>
          <input name="password" type="password" value={formData.password} onChange={handleChange} required />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Входим...' : 'Войти'}</button>
        </form>
      </div>
    </div>
  );
};

export default Login;
