import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDepartments, searchEmployees } from '../services/employeeService';
import './Register.css';

const Register = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    room: '',
    department: '',
    internalPhone: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  const [departments, setDepartments] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const { registerEmployee } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const list = await getDepartments();
        setDepartments(Array.isArray(list) ? list : []);
      } catch (err) {
        console.error('Ошибка загрузки отделов для регистрации:', err);
      }
    };

    loadDepartments();
  }, []);

  useEffect(() => {
    const query = formData.fullName.trim();

    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const employees = await searchEmployees('full_name', query);
        setSuggestions(Array.isArray(employees) ? employees.slice(0, 8) : []);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Ошибка поиска сотрудника для автозаполнения:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [formData.fullName]);

  const suggestionsText = useMemo(() => {
    if (isSearching) return 'Поиск сотрудника в базе...';
    if (!formData.fullName.trim() || formData.fullName.trim().length < 2) return 'Введите минимум 2 символа ФИО';
    if (suggestions.length === 0) return 'Совпадений не найдено';
    return `Найдено: ${suggestions.length}`;
  }, [formData.fullName, suggestions.length, isSearching]);

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value
    }));

    if (error) setError('');
    if (successMessage) setSuccessMessage('');
  };

  const applySuggestion = (employee) => {
    setFormData((prev) => ({
      ...prev,
      fullName: employee.full_name || prev.fullName,
      room: employee.room || prev.room,
      department: employee.department || prev.department,
      internalPhone: employee.internal_phone || prev.internalPhone,
      email: employee.email || prev.email
    }));
    setShowSuggestions(false);
  };

  const handleRegister = async (e) => {
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
      await registerEmployee({
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        department: formData.department,
        room: formData.room,
        internalPhone: formData.internalPhone
      });
      setSuccessMessage('Сотрудник зарегистрирован. Теперь можно войти в систему.');
      setTimeout(() => navigate('/login'), 1000);
    } catch (err) {
      setError(err.message || 'Ошибка регистрации');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="register-page">
      <div className="register-shell">
        <div className="register-intro">
          <p className="register-year">Новосибирск · 2026</p>
          <h1>Регистрация нового сотрудника</h1>
          <p>
            Заполните данные сотрудника. Если человек уже есть в базе «Сотрудники»,
            начните вводить ФИО — карточка подгрузится автоматически.
          </p>
        </div>

        <div className="register-card">
          <form onSubmit={handleRegister} className="register-form-grid" autoComplete="off">
            <div className="register-field register-field-full suggestions-wrap">
              <label htmlFor="fullName">ФИО сотрудника *</label>
              <input
                type="text"
                id="fullName"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                required
                disabled={isLoading}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Начните вводить фамилию..."
              />
              <small>{suggestionsText}</small>

              {showSuggestions && suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {suggestions.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className="suggestion-item"
                      onClick={() => applySuggestion(item)}
                    >
                      <strong>{item.full_name}</strong>
                      <span>{item.department || 'Без отдела'} · каб. {item.room || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="register-field">
              <label htmlFor="department">Отдел *</label>
              <select
                id="department"
                name="department"
                value={formData.department}
                onChange={handleChange}
                required
                disabled={isLoading}
              >
                <option value="">Выберите отдел</option>
                {departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </div>

            <div className="register-field">
              <label htmlFor="room">Кабинет *</label>
              <input
                type="text"
                id="room"
                name="room"
                value={formData.room}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="register-field">
              <label htmlFor="internalPhone">Внутренний телефон *</label>
              <input
                type="text"
                id="internalPhone"
                name="internalPhone"
                value={formData.internalPhone}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="register-field">
              <label htmlFor="email">Почта (логин) *</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="register-field">
              <label htmlFor="password">Пароль *</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="register-field">
              <label htmlFor="confirmPassword">Подтверждение пароля *</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="register-actions register-field-full">
              <button type="submit" disabled={isLoading}>
                {isLoading ? 'Регистрация...' : 'Зарегистрировать сотрудника'}
              </button>
            </div>
          </form>

          {error && <div className="register-error">{error}</div>}
          {successMessage && <div className="register-success">{successMessage}</div>}

          <div className="register-links">
            <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
