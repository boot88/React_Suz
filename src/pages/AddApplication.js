import AdminNotice from '../components/AdminNotice';
import { useAdminTranslation } from '../utils/adminTranslation';
import React, { useEffect, useRef, useState } from 'react';
import './AddApplication.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import applicationValidation from '../utils/applicationValidation';
import { readFormDraft, useFormDraft } from '../utils/useFormDraft';

const { validateApplicationField, validateApplication } = applicationValidation;

const AddApplication = () => {
  const t = useAdminTranslation();
  const initialDraft = useRef(readFormDraft('new-request', {}));
  const operationRef = useRef(initialDraft.current.operation || null);
  const submitLock = useRef(false);
  const [formData, setFormData] = useState(() => initialDraft.current.formData || {
    name: '',
    cabinet: '',
    N_tel: '',
    application: '',
    executor: '',
    fl: false
  });

  const clearDraft = useFormDraft('new-request', { formData, operation: operationRef.current }, Boolean(formData.name || formData.application || formData.cabinet || formData.N_tel || formData.executor));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [errors, setErrors] = useState({});
  const [employeeHints, setEmployeeHints] = useState([]);

  const validateField = (name, value) => validateApplicationField(name, value, { requireCabinet: true });
  const validateName = (value) => validateField('name', value);
  const validateCabinet = (value) => validateField('cabinet', value);
  const validatePhone = (value) => validateField('N_tel', value);

  useEffect(() => {
    const query = formData.name.trim();
    if (query.length < 2) {
      setEmployeeHints([]);
      return undefined;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/employees/search?field=full_name&query=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Directory request failed');
        const employees = await response.json();
        if (controller.signal.aborted) return;
        setEmployeeHints(Array.isArray(employees) ? employees.slice(0, 8) : []);
      } catch {
        if (!controller.signal.aborted) setEmployeeHints([]);
      }
    }, 220);

    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [formData.name]);

  const applyEmployeeHint = (employee) => {
    const name = employee.full_name || '';
    const cabinet = employee.room || employee.department || '';
    const phone = employee.internal_phone || '';
    setFormData((prev) => ({ ...prev, name, cabinet, N_tel: phone }));
    setErrors((prev) => ({
      ...prev,
      name: validateName(name),
      cabinet: validateCabinet(cabinet),
      N_tel: validatePhone(phone)
    }));
    setEmployeeHints([]);
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
    const next = validateApplication(formData, { requireCabinet: true });
    setErrors(next); return Object.keys(next).length === 0;
  };
  const sanitizeData = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitLock.current) return;
    
    if (!validateForm()) {
      setMessage({ 
        text: 'Пожалуйста, исправьте ошибки в форме', 
        type: 'error' 
      });
      return;
    }

    submitLock.current = true;
    setIsSubmitting(true);
    setMessage({ text: '', type: '' });

    try {
      // Санитизация данных перед отправкой
      const sanitizedData = sanitizeData({
        name: formData.name || '',
        cabinet: formData.cabinet || '',
        N_tel: formData.N_tel || '',
        application: formData.application || '',
        executor: formData.executor || '',
        fl: Boolean(formData.fl),
        status: formData.fl ? 'done' : 'in_progress',
        source: 'admin',
        process: formData.fl ? '-' : ''
      });

      const fingerprint = JSON.stringify(sanitizedData);
      if (!operationRef.current || operationRef.current.fingerprint !== fingerprint) operationRef.current = { fingerprint, key: window.crypto?.randomUUID?.() || `application-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      const idempotencyKey = operationRef.current.key;
      try { sessionStorage.setItem(`draft:${JSON.parse(localStorage.getItem('authState') || 'null')?.user?.username?.toLowerCase() || ''}:new-request`, JSON.stringify({ formData, operation: operationRef.current })); } catch {}

      const response = await authFetch(`${API_BASE_URL}/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ ...sanitizedData, idempotency_key: idempotencyKey })
      });

      const responseData = await response.json();

      if (response.ok) {
        clearDraft(); operationRef.current = null;
        window.dispatchEvent(new Event('applications:refresh'));
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
        if (responseData.errors) setErrors(responseData.errors);
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
      submitLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-application-container">
      <div className="add-application-header">
        <h2>{t("Добавить новую заявку")}</h2>
        <p>{t("Институт органической химии - Система учёта заявки")}</p>
      </div>

      <form onSubmit={handleSubmit} className="application-form">
        <div className="form-section">
          <h3>{t("Основная информация")}</h3>
          <div className="form-grid">
            <div className="form-group with-icon" id="name-field">
              <label htmlFor="name">{t("ФИО научного сотрудника *")}</label>
              <input
                id="name"
                name="name"
                type="text"
                placeholder={t("Введите полное имя сотрудника")}
                value={formData.name}
                onChange={handleChange}
                required
                maxLength={40}
                className={errors.name ? 'error' : ''}
              />
              {errors.name && <span className="error-text">{t(errors.name)}</span>}
              <div className="character-count">{formData.name.length}/40</div>
              {employeeHints.length > 0 && (
                <div className="employee-name-hints" role="listbox" aria-label={t("Сотрудники из справочника")}>
                  {employeeHints.map((employee) => (
                    <button
                      key={employee.id || `${employee.full_name}-${employee.room}-${employee.internal_phone}`}
                      type="button"
                      onClick={() => applyEmployeeHint(employee)}
                    >
                      <strong>{employee.full_name}</strong>
                      <span>{employee.department || t('Отдел не указан')}{t(" · каб. ")}{employee.room || '—'}{t(" · вн. ")}{employee.internal_phone || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group with-icon" id="cabinet-field">
              <label htmlFor="cabinet">{t("Лаборатория/Кабинет *")}</label>
              <input
                id="cabinet"
                name="cabinet"
                type="text"
                placeholder={t("Номер лаборатории или кабинета")}
                value={formData.cabinet}
                onChange={handleChange}
                required
                maxLength={15}
                className={errors.cabinet ? 'error' : ''}
              />
              {errors.cabinet && <span className="error-text">{t(errors.cabinet)}</span>}
              <div className="character-count">{formData.cabinet.length}/15</div>
            </div>

            <div className="form-group with-icon" id="phone-field">
              <label htmlFor="N_tel">{t("Внутренний телефон")}</label>
              <input
                id="N_tel"
                name="N_tel"
                type="tel"
                placeholder={t("Внутренний номер")}
                value={formData.N_tel}
                onChange={handleChange}
                maxLength={15}
                className={errors.N_tel ? 'error' : ''}
              />
              {errors.N_tel && <span className="error-text">{t(errors.N_tel)}</span>}
              <div className="character-count">{formData.N_tel.length}/15</div>
            </div>

            <div className="form-group">
              <label htmlFor="executor">{t("Исполнитель")}</label>
              <input
                id="executor"
                name="executor"
                type="text"
                placeholder={t("ФИО исполнителя")}
                value={formData.executor}
                onChange={handleChange}
                maxLength={60}
                className={errors.executor ? 'error' : ''}
              />
              {errors.executor && <span className="error-text">{t(errors.executor)}</span>}
              <div className="character-count">{formData.executor.length}/60</div>
            </div>
          </div>
        </div>

        <div className="form-section">
          <h3>{t("Описание заявки")}</h3>
          <div className="form-group">
            <label htmlFor="application">{t("Суть заявки *")}</label>
            <textarea
              id="application"
              name="application"
              placeholder={t("Опишите проблему или задачу, укажите необходимое оборудование или реактивы")}
              value={formData.application}
              onChange={handleChange}
              rows="4"
              required
              maxLength={500}
              className={errors.application ? 'error' : ''}
            />
            {errors.application && <span className="error-text">{t(errors.application)}</span>}
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
              <span className="checkbox-custom"></span>{t("Заявка выполнена")}</label>
          </div>
        </div>

        <div className="form-actions">
          <button 
            type="submit" 
            className="submit-button"
            disabled={isSubmitting}
          >
            {t(isSubmitting ? 'Добавление...' : 'Добавить заявку')}
          </button>
          
          <button 
            type="button" 
            className="cancel-button"
            onClick={() => window.history.back()}
          >{t("Назад")}</button>
        </div>
        {message.text && (
          <AdminNotice type={message.type}>{t(message.text)}</AdminNotice>
        )}
      </form>
    </div>
  );
};

export default AddApplication;
