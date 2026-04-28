import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../utils/apiConfig';
import './Register.css';

const Register = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    room: '',
    department: '',
    internalPhone: '',
    email: ''
  });
  const [departments, setDepartments] = useState([]);
  const [nameHints, setNameHints] = useState([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { registerEmployee } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/employees/departments`);
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data)) setDepartments(data);
      } catch {
        // ignore optional helper data
      }
    };

    loadDepartments();
  }, []);

  useEffect(() => {
    const query = formData.fullName.trim();
    if (query.length < 2) {
      setNameHints([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/employees/search?field=full_name&query=${encodeURIComponent(query)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (Array.isArray(data)) {
          setNameHints(data.slice(0, 6));
        }
      } catch {
        setNameHints([]);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [formData.fullName]);

  const hasHints = useMemo(() => nameHints.length > 0, [nameHints]);

  const applyHint = (hint) => {
    setFormData((prev) => ({
      ...prev,
      fullName: hint.full_name || prev.fullName,
      room: hint.room || prev.room,
      department: hint.department || prev.department,
      internalPhone: hint.internal_phone || prev.internalPhone,
      email: hint.email || prev.email
    }));
    setNameHints([]);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }));

    if (error) setError('');
    if (successMessage) setSuccessMessage('');
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    setIsLoading(true);

    try {
      await registerEmployee(formData.email, {
        fullName: formData.fullName,
        room: formData.room,
        department: formData.department,
        internalPhone: formData.internalPhone
      });
      setSuccessMessage(`Сотрудник зарегистрирован. Пароль отправлен на ${formData.email.trim().toLowerCase()}.`);
      setTimeout(() => navigate('/login'), 1000);
    } catch (err) {
      setError(err.message || 'Ошибка регистрации');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="register-container">
      <div className="register-card">
        <div className="register-header">
          <p>Новосибирск · 2026</p>
          <h2>Регистрация сотрудника</h2>
        </div>

        <form onSubmit={handleRegister} className="register-form">
          <label>
            ФИО сотрудника *
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              required
              disabled={isLoading}
              placeholder="Иванов Иван Иванович"
            />
          </label>

          {hasHints && (
            <div className="name-hints">
              {nameHints.map((hint) => (
                <button key={`${hint.full_name}-${hint.email || hint.room}`} type="button" onClick={() => applyHint(hint)}>
                  {hint.full_name} · {hint.department || 'без отдела'} · {hint.room || '—'}
                </button>
              ))}
            </div>
          )}

          <div className="grid-two">
            <label>
              Отдел
              <select
                name="department"
                value={formData.department}
                onChange={handleChange}
                disabled={isLoading}
              >
                <option value="">Выберите отдел</option>
                {departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </label>

            <label>
              Кабинет
              <input
                type="text"
                name="room"
                value={formData.room}
                onChange={handleChange}
                disabled={isLoading}
              />
            </label>
          </div>

          <div className="grid-two">
            <label>
              Внутренний телефон
              <input
                type="text"
                name="internalPhone"
                value={formData.internalPhone}
                onChange={handleChange}
                disabled={isLoading}
              />
            </label>

            <label>
              Email (логин) *
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </label>
          </div>

          <p className="register-note">
            Пароль создавать не нужно — он будет автоматически сгенерирован и отправлен на указанную почту.
          </p>

          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Регистрация...' : 'Зарегистрировать сотрудника'}
          </button>
        </form>

        {error && <div className="register-error">{error}</div>}
        {successMessage && <div className="register-success">{successMessage}</div>}

        <div className="register-footer">
          <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
        </div>
      </div>
    </div>
  );
};

export default Register;
