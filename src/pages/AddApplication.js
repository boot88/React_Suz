import React, { useState } from 'react';
import './AddApplication.css';

const AddApplication = () => {
  const [formData, setFormData] = useState({
    name: '',
    cabinet: '',
    N_tel: '',
    application: '',
    process: '',
    executor: '',
    data: new Date().toISOString().split('T')[0],
    start_data: '',
    end_data: '',
    fl: false
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage({ text: '', type: '' });

    try {
      // Подготавливаем данные для отправки
      const submissionData = {
        name: formData.name || '',
        cabinet: formData.cabinet || '',
        N_tel: formData.N_tel || '',
        application: formData.application || '',
        process: formData.process || '',
        executor: formData.executor || '',
        data: formData.data || new Date().toISOString().split('T')[0],
        start_data: formData.start_data || '',
        end_data: formData.end_data || '',
        fl: Boolean(formData.fl)
      };

      console.log('Отправляемые данные:', submissionData);

      const response = await fetch('http://localhost:5000/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionData)
      });

      const responseData = await response.json();

      if (response.ok) {
        setMessage({ 
          text: 'Заявка успешно добавлена в систему!', 
          type: 'success' 
        });
        // Сбрасываем форму
        setFormData({
          name: '',
          cabinet: '',
          N_tel: '',
          application: '',
          process: '',
          executor: '',
          data: new Date().toISOString().split('T')[0],
          start_data: '',
          end_data: '',
          fl: false
        });
      } else {
        setMessage({ 
          text: `Ошибка при добавлении: ${responseData.error || responseData.details || 'Неизвестная ошибка'}`,
          type: 'error'
        });
      }
    } catch (error) {
      console.error('Ошибка:', error);
      setMessage({ 
        text: 'Сетевая ошибка. Проверьте подключение к серверу.',
        type: 'error'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-application-container">
      <div className="add-application-header">
        <h2>Добавить новую заявку</h2>
        <p>Институт органической химии - Система учёта заявок</p>
      </div>

      {message.text && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

       <form onSubmit={handleSubmit} className="application-form">
      <div className="form-section">
        <h3>Основная информация</h3>
        <div className="form-grid">
          <div className="form-group with-icon" id="name-field">
            <label htmlFor="name">ФИО научного сотрудника *</label>
            <input
              id="name"
              name="name"
              type="text"
              placeholder="Введите полное имя сотрудника"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group with-icon" id="cabinet-field">
            <label htmlFor="cabinet">Лаборатория/Кабинет</label>
            <input
              id="cabinet"
              name="cabinet"
              type="text"
              placeholder="Номер лаборатории или кабинета"
              value={formData.cabinet}
              onChange={handleChange}
            />
          </div>

          <div className="form-group with-icon" id="phone-field">
            <label htmlFor="N_tel">Внутренний телефон</label>
            <input
              id="N_tel"
              name="N_tel"
              type="tel"
              placeholder="Внутренний номер"
              value={formData.N_tel}
              onChange={handleChange}
            />
          </div>

          <div className="form-group date-time-field">
            <label htmlFor="data">Дата заявки *</label>
            <input
              id="data"
              name="data"
              type="date"
              value={formData.data}
              onChange={handleChange}
              required
            />
          </div>
        </div>
      </div>

        <div className="form-section">
          <h3>Описание заявки</h3>
          <div className="form-group">
            <label htmlFor="application">Суть заявки *</label>
            <textarea
              id="application"
              name="application"
              placeholder="Опишите проблему или задачу, укажите необходимое оборудование или реактивы"
              value={formData.application}
              onChange={handleChange}
              rows="4"
              required
            />
          </div>
        </div>

        <div className="form-section">
          <h3>Исполнение</h3>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="process">Выполненные работы</label>
              <textarea
                id="process"
                name="process"
                placeholder="Опишите выполненные работы, использованные материалы"
                value={formData.process}
                onChange={handleChange}
                rows="3"
              />
            </div>

            <div className="form-group">
              <label htmlFor="executor">Исполнитель (техник/инженер)</label>
              <input
                id="executor"
                name="executor"
                type="text"
                placeholder="ФИО исполнителя"
                value={formData.executor}
                onChange={handleChange}
              />
            </div>

           <div className="form-group date-time-field">
            <label htmlFor="start_data">Дата начала работ</label>
            <input
              id="start_data"
              name="start_data"
              type="datetime-local"
              value={formData.start_data}
              onChange={handleChange}
            />
          </div>

          <div className="form-group date-time-field">
            <label htmlFor="end_data">Дата окончания работ</label>
            <input
              id="end_data"
              name="end_data"
              type="datetime-local"
              value={formData.end_data}
              onChange={handleChange}
            />
          </div>
        </div>
      </div>

        <div className="form-section">
          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="fl"
                checked={formData.fl}
                onChange={handleChange}
                className="checkbox-input"
              />
              <span className="checkbox-custom"></span>
              Заявка выполнена
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button 
            type="submit" 
            className="submit-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Добавление...' : 'Добавить заявку'}
          </button>
          
          <button 
            type="button" 
            className="cancel-button"
            onClick={() => window.history.back()}
          >
            Назад
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddApplication;