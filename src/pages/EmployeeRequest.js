import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './EmployeeRequest.css';

const EmployeeRequest = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [application, setApplication] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (user.role !== 'employee') {
      navigate('/dashboard');
      return;
    }
  }, [user, navigate]);

  const handleSubmit = async (e) => {
  e.preventDefault();
  setIsLoading(true);
  setMessage('');

  try {
    const response = await fetch('http://localhost:5000/api/applications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        application: application,
        status: 'в работе',
        user: user
      }),
    });

    const data = await response.json();

    if (response.ok) {
      setMessage('Заявка успешно отправлена!');
      setApplication('');
    } else {
      setMessage(data.message || 'Ошибка при отправке заявки');
    }
  } catch (error) {
    setMessage('Ошибка соединения с сервером');
  } finally {
    setIsLoading(false);
  }
};

  if (!user || user.role !== 'employee') {
    return <div>Загрузка...</div>;
  }

  return (
    <div className="employee-request-container">
      <div className="employee-request-header">
        <h2>Подача заявки на ремонт техники</h2>
        <div className="user-info">
          <p><strong>Сотрудник:</strong> {user.full_name}</p>
          <p><strong>Подразделение:</strong> {user.department}</p>
          <p><strong>Телефон:</strong> {user.phone}</p>
          <p><strong>Кабинет:</strong> {user.room}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="request-form">
        <div className="form-group">
          <label htmlFor="application">Служебная записка *</label>
          <textarea
            id="application"
            value={application}
            onChange={(e) => setApplication(e.target.value)}
            placeholder="Опишите проблему, поломку или неисправность..."
            required
            rows="8"
          />
        </div>

        {message && (
          <div className={`message ${message.includes('успешно') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}

        <button type="submit" disabled={isLoading || !application.trim()}>
          {isLoading ? 'Отправка...' : 'Отправить заявку'}
        </button>
      </form>

      <div className="request-info">
        <h3>Информация о заявке:</h3>
        <ul>
          <li>Все заявки автоматически получают статус "в работе"</li>
          <li>Заявка будет зарегистрирована с текущей датой и временем</li>
          <li>Ваши данные (ФИО, подразделение, телефон, кабинет) будут автоматически прикреплены к заявке</li>
        </ul>
      </div>
    </div>
  );
};

export default EmployeeRequest;