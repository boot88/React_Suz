import React, { useState } from 'react';
import './AddApplication.css';
import { API_BASE_URL } from '../utils/apiConfig';

const AddApplication = () => {
  const [formData, setFormData] = useState({
    name: '',
    cabinet: '',
    N_tel: '',
    application: '',
    executor: '',
    fl: false
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [errors, setErrors] = useState({});

  // Функция для получения текущей даты и времени для Новосибирска (UTC+7)
  const getCurrentNovosibirskDateTime = () => {
    const now = new Date();
    const timezoneOffset = now.getTimezoneOffset() + 840; // +7 часов
    return new Date(now.getTime() + timezoneOffset * 60000);
  };

  // Функция для форматирования даты в формат для datetime-local
  const formatDateTimeForInput = (date) => {
    return date.toISOString().slice(0, 16);
  };

  // Валидационные функции
  const validateName = (value) => {
    if (!value.trim()) return 'ФИО обязательно для заполнения';
    if (value.length > 40) return 'Максимум 40 символов';
    if (!/^[а-яА-ЯёЁ\s]+$/.test(value)) return 'Только русские буквы и пробелы';
    return '';
  };

  const validateCabinet = (value) => {
    if (!value.trim()) return 'Лаборатория/кабинет обязателен для заполнения';
    if (value.length > 15) return 'Максимум 15 символов';
    if (!/^[а-яА-ЯёЁ0-9\s,\-]+$/.test(value)) return 'Только русские буквы, цифры, пробелы, запятые и дефис';
    return '';
  };

  const validatePhone = (value) => {
    if (value && value.length > 15) return 'Максимум 15 символов';
    if (value && !/^[0-9\s,-]+$/.test(value)) return 'Только цифры, пробелы, запятые и дефис';
    return '';
  };

  const validateApplication = (value) => {
    if (!value.trim()) return 'Суть заявки обязательна для заполнения';
    if (value.length > 500) return 'Максимум 500 символов';
    if (/[<>$&|;`\\]/.test(value)) return 'Недопустимые символы в тексте';
    return '';
  };

  const validateExecutor = (value) => {
    if (!value) return '';
    if (value.length > 60) return 'Максимум 60 символов';
    if (!/^[а-яА-ЯёЁ\s,\.]+$/.test(value)) return 'Только русские буквы, пробелы, запятые и точки';
    return '';
  };

  const validateField = (name, value) => {
    switch (name) {
      case 'name':
        return validateName(value);
      case 'cabinet':
        return validateCabinet(value);
      case 'N_tel':
        return validatePhone(value);
      case 'application':
        return validateApplication(value);
      case 'executor':
        return validateExecutor(value);
      default:
        return '';
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const fieldValue = type === 'checkbox' ? checked : value;
    
    // Валидация в реальном времени
    const error = validateField(name, fieldValue);
    setErrors(prev => ({
      ...prev,
      [name]: error
    }));

    setFormData(prev => ({
      ...prev,
      [name]: fieldValue
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    
    newErrors.name = validateName(formData.name);
    newErrors.cabinet = validateCabinet(formData.cabinet);
    newErrors.N_tel = validatePhone(formData.N_tel);
    newErrors.application = validateApplication(formData.application);
    newErrors.executor = validateExecutor(formData.executor);

    setErrors(newErrors);

    return !Object.values(newErrors).some(error => error !== '');
  };

  // Функция для санитизации данных
  const sanitizeData = (data) => {
    const sanitized = { ...data };
    
    // Убираем лишние пробелы
    sanitized.name = sanitized.name.trim();
    sanitized.cabinet = sanitized.cabinet.trim();
    sanitized.N_tel = sanitized.N_tel.trim();
    sanitized.application = sanitized.application.trim();
    sanitized.executor = sanitized.executor.trim();

    // Экранирование специальных символов
    const escapeHtml = (text) => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    sanitized.application = escapeHtml(sanitized.application);
    sanitized.process = '-'; // Ставим "-" для выполненных работ

    return sanitized;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      setMessage({ 
        text: 'Пожалуйста, исправьте ошибки в форме', 
        type: 'error' 
      });
      return;
    }

    setIsSubmitting(true);
    setMessage({ text: '', type: '' });

    try {
      // Получаем текущую дату и время для Новосибирска
      const currentDateTime = getCurrentNovosibirskDateTime();
      const startData = formData.fl ? formatDateTimeForInput(currentDateTime) : null;
      const endData = formData.fl ? formatDateTimeForInput(new Date(currentDateTime.getTime() + 30 * 60000)) : null;

      // Санитизация данных перед отправкой
      const sanitizedData = sanitizeData({
        name: formData.name || '',
        cabinet: formData.cabinet || '',
        N_tel: formData.N_tel || '',
        application: formData.application || '',
        executor: formData.executor || '',
        data: currentDateTime.toISOString().split('T')[0], // Текущая дата
        start_data: startData,
        end_data: endData,
        fl: Boolean(formData.fl),
        status: formData.fl ? 'done' : 'new',
        source: 'admin',
        process: formData.fl ? '-' : ''
      });

      console.log('Отправляемые данные:', sanitizedData);

      const response = await fetch(`${API_BASE_URL}/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizedData)
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
          executor: '',
          fl: false
        });
        setErrors({});
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
        <p>Институт органической химии - Система учёта заявки</p>
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
                maxLength={40}
                className={errors.name ? 'error' : ''}
              />
              {errors.name && <span className="error-text">{errors.name}</span>}
              <div className="character-count">{formData.name.length}/40</div>
            </div>

            <div className="form-group with-icon" id="cabinet-field">
              <label htmlFor="cabinet">Лаборатория/Кабинет *</label>
              <input
                id="cabinet"
                name="cabinet"
                type="text"
                placeholder="Номер лаборатории или кабинета"
                value={formData.cabinet}
                onChange={handleChange}
                required
                maxLength={15}
                className={errors.cabinet ? 'error' : ''}
              />
              {errors.cabinet && <span className="error-text">{errors.cabinet}</span>}
              <div className="character-count">{formData.cabinet.length}/15</div>
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
                maxLength={15}
                className={errors.N_tel ? 'error' : ''}
              />
              {errors.N_tel && <span className="error-text">{errors.N_tel}</span>}
              <div className="character-count">{formData.N_tel.length}/15</div>
            </div>

            <div className="form-group">
              <label htmlFor="executor">Исполнитель</label>
              <input
                id="executor"
                name="executor"
                type="text"
                placeholder="ФИО исполнителя"
                value={formData.executor}
                onChange={handleChange}
                maxLength={60}
                className={errors.executor ? 'error' : ''}
              />
              {errors.executor && <span className="error-text">{errors.executor}</span>}
              <div className="character-count">{formData.executor.length}/60</div>
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
              maxLength={500}
              className={errors.application ? 'error' : ''}
            />
            {errors.application && <span className="error-text">{errors.application}</span>}
            <div className="character-count">{formData.application.length}/500</div>
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