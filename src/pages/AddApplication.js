import React, { useState } from 'react';
import './AddApplication.css';
import { API_BASE_URL } from '../utils/apiConfig';

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
  const [errors, setErrors] = useState({});

  // Валидационные функции
  const validateName = (value) => {
    if (!value.trim()) return 'ФИО обязательно для заполнения';
    if (value.length > 40) return 'Максимум 40 символов';
    if (!/^[а-яА-ЯёЁ\s]+$/.test(value)) return 'Только русские буквы и пробелы';
    return '';
  };

  const validateCabinet = (value) => {
    if (value && value.length > 15) return 'Максимум 15 символов';
    if (value && !/^[а-яА-ЯёЁ0-9\s,\-]+$/.test(value)) return 'Только русские буквы, цифры, пробелы, запятые и дефис';
    return '';
  };

  const validatePhone = (value) => {
    if (value && value.length > 15) return 'Максимум 15 символов';
    if (value && !/^[0-9\s\-]+$/.test(value)) return 'Только цифры, пробелы и дефис';
    return '';
  };

  const validateApplication = (value) => {
    if (!value.trim()) return 'Суть заявки обязательна для заполнения';
    if (value.length > 500) return 'Максимум 500 символов';
    // Защита от инъекций - экранирование специальных символов
    if (/[<>$&|;`\\]/.test(value)) return 'Недопустимые символы в тексте';
    return '';
  };

  const validateProcess = (value) => {
    if (value && value.length > 1500) return 'Максимум 1500 символов';
    if (value && /[<>$&|;`\\]/.test(value)) return 'Недопустимые символы в тексте';
    return '';
  };

  const validateExecutor = (value) => {
    if (value && value.length > 60) return 'Максимум 60 символов';
    if (value && !/^[а-яА-ЯёЁ\s,\.]+$/.test(value)) return 'Только русские буквы, пробелы, запятые и точки';
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
      case 'process':
        return validateProcess(value);
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

    setFormData({
      ...formData,
      [name]: fieldValue
    });
  };

  const validateForm = () => {
    const newErrors = {};
    
    newErrors.name = validateName(formData.name);
    newErrors.cabinet = validateCabinet(formData.cabinet);
    newErrors.N_tel = validatePhone(formData.N_tel);
    newErrors.application = validateApplication(formData.application);
    newErrors.process = validateProcess(formData.process);
    newErrors.executor = validateExecutor(formData.executor);

    setErrors(newErrors);

    return !Object.values(newErrors).some(error => error !== '');
  };

  // Функция для санитизации данных (защита от инъекций)
  const sanitizeData = (data) => {
    const sanitized = { ...data };
    
    // Убираем лишние пробелы
    sanitized.name = sanitized.name.trim();
    sanitized.cabinet = sanitized.cabinet.trim();
    sanitized.N_tel = sanitized.N_tel.trim();
    sanitized.application = sanitized.application.trim();
    sanitized.process = sanitized.process.trim();
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
    sanitized.process = escapeHtml(sanitized.process);

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
      // Санитизация данных перед отправкой
      const sanitizedData = sanitizeData({
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
          process: '',
          executor: '',
          data: new Date().toISOString().split('T')[0],
          start_data: '',
          end_data: '',
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
              <label htmlFor="cabinet">Лаборатория/Кабинет</label>
              <input
                id="cabinet"
                name="cabinet"
                type="text"
                placeholder="Номер лаборатории или кабинета"
                value={formData.cabinet}
                onChange={handleChange}
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
              maxLength={500}
              className={errors.application ? 'error' : ''}
            />
            {errors.application && <span className="error-text">{errors.application}</span>}
            <div className="character-count">{formData.application.length}/500</div>
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
                maxLength={1500}
                className={errors.process ? 'error' : ''}
              />
              {errors.process && <span className="error-text">{errors.process}</span>}
              <div className="character-count">{formData.process.length}/1500</div>
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
                maxLength={60}
                className={errors.executor ? 'error' : ''}
              />
              {errors.executor && <span className="error-text">{errors.executor}</span>}
              <div className="character-count">{formData.executor.length}/60</div>
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