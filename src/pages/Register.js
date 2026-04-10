import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Register.css';

const Register = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    verificationCode: ''
  });
  const [pendingEmail, setPendingEmail] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { registerEmployee, verifyEmployeeEmail } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value
    }));

    if (error) setError('');
    if (successMessage) setSuccessMessage('');
  };

  const handleRegister = (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (formData.password !== formData.confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    if (formData.password.length < 6) {
      setError('Минимальная длина пароля — 6 символов');
      return;
    }

    setIsLoading(true);

    try {
      const result = registerEmployee(formData.email, formData.password);
      setPendingEmail(result.email);
      setGeneratedCode(result.verificationCode);
      setSuccessMessage('Сотрудник зарегистрирован. Подтвердите email кодом.');
    } catch (err) {
      setError(err.message || 'Ошибка регистрации');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    try {
      verifyEmployeeEmail(pendingEmail, formData.verificationCode);
      setSuccessMessage('Email подтвержден. Теперь можно входить в систему.');
      setTimeout(() => navigate('/login'), 800);
    } catch (err) {
      setError(err.message || 'Ошибка подтверждения email');
    }
  };

  return (
    <div className="register-container">
      <div className="register-form">
        <h2>Регистрация сотрудника</h2>

        <form onSubmit={handleRegister}>
          <div className="form-group">
            <label htmlFor="email">Email (логин) *</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              disabled={Boolean(pendingEmail)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Пароль *</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              disabled={Boolean(pendingEmail)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirmPassword">Подтверждение пароля *</label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
              disabled={Boolean(pendingEmail)}
            />
          </div>
          {!pendingEmail && (
            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Регистрация...' : 'Зарегистрировать сотрудника'}
            </button>
          )}
        </form>

        {pendingEmail && (
          <form onSubmit={handleVerify} className="verify-form">
            <div className="form-group">
              <label htmlFor="verificationCode">Код подтверждения email *</label>
              <input
                type="text"
                id="verificationCode"
                name="verificationCode"
                value={formData.verificationCode}
                onChange={handleChange}
                required
              />
            </div>
            <div className="verification-hint">
              Техническая заглушка этапа 1: код отправки по email = <strong>{generatedCode}</strong>
            </div>
            <button type="submit">Подтвердить email</button>
          </form>
        )}

        {error && <div className="error-message">{error}</div>}
        {successMessage && <div className="success-message">{successMessage}</div>}

        <div className="register-links">
          <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
        </div>
      </div>
    </div>
  );
};

export default Register;
