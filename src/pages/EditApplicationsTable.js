import AdminNotice from '../components/AdminNotice';
import { useAdminTranslation, getAdminLocale } from '../utils/adminTranslation';
import { userSettingsStorage } from '../utils/userPreferences';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './EditApplicationsTable.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';
import applicationValidation from '../utils/applicationValidation';
import { readFormDraft, useFormDraft } from '../utils/useFormDraft';
import { useAuth } from '../context/AuthContext';

const SHOW_EDIT_APPLICATION_TABLE_KEY = 'admin.showEditApplicationTable';

const { validateApplicationField, validateApplication } = applicationValidation;

function EditApplicationsTable() {
  const t = useAdminTranslation();
  const { isLoading: authLoading } = useAuth();
  const { id: applicationId } = useParams();
  const navigate = useNavigate();
  const showIntermediateTable = userSettingsStorage.getItem(SHOW_EDIT_APPLICATION_TABLE_KEY) === 'true';
  const directEditingMode = Boolean(applicationId) && !showIntermediateTable;
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editingApp, setEditingApp] = useState({});
  const baselineRef = useRef(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = editing && baselineRef.current && JSON.stringify(editingApp) !== JSON.stringify(baselineRef.current);
  const clearDraft = useFormDraft(`edit-request:${editingApp.id || applicationId}`, editingApp, dirty);
  const [successMessage, setSuccessMessage] = useState('');
  const [notice, setNotice] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [employeeHints, setEmployeeHints] = useState([]);
  const [selectedDirectoryName, setSelectedDirectoryName] = useState('');

  const adjustForNovosibirskTime = (date) => {
    const localDate = new Date(date);
    const timezoneOffset = localDate.getTimezoneOffset() + 420;
    return new Date(localDate.getTime() + timezoneOffset * 60000);
  };

  const loadController = useRef(null);
  const loadRetry = useRef(null);
  const fetchApplications = useCallback(async (attempt = 0) => {
    if (authLoading) return;
    loadController.current?.abort(); window.clearTimeout(loadRetry.current);
    const controller = new AbortController(); loadController.current = controller;
    setLoading(true);
    setError(null);
    try {
      if (directEditingMode) {
        const response = await authFetch(`${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}`, { signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok || !data.application) {
          throw new Error(data.error || 'Заявка не найдена');
        }
        setApplications([data.application]);
        setTotalPages(1);
        setTotalItems(1);
        setEditing(true);
        baselineRef.current = data.application;
        const draft = readFormDraft(`edit-request:${data.application.id}`, null);
        const restored = draft && String(draft.id) === String(data.application.id);
        const stale = Boolean(restored && draft.revision !== data.application.revision);
        setEditingApp(restored ? draft : { ...data.application });
        setConflict(stale);
        setNotice(stale ? { text: 'Заявка изменена другим администратором. Загрузите актуальную версию перед сохранением.', type: 'warning' } : null);
        setFieldErrors({});
        setEmployeeHints([]);
        setSelectedDirectoryName('');
        setLoading(false);
        return;
      }
      const statusQuery = statusFilter !== 'all' ? `&status=${encodeURIComponent(statusFilter)}` : '';
      const response = await authFetch(
        `${API_BASE_URL}/applications?page=${currentPage}&limit=${itemsPerPage}${statusQuery}`, { signal: controller.signal }
      );
      
      if (!response.ok) {
        throw new Error(`Ошибка сервера: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (controller.signal.aborted) return;
      setApplications(data.applications || []);
      setTotalPages(data.totalPages || 1);
      setTotalItems(data.total ?? data.stats?.total ?? 0);
      setLoading(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (attempt < 2) {
        loadRetry.current = window.setTimeout(() => { if (!controller.signal.aborted) fetchApplications(attempt + 1); }, 400 * (attempt + 1));
        return;
      }
      console.error('Ошибка загрузки:', err.message);
      setError('Не удалось загрузить данные. Проверьте подключение к серверу.');
      setLoading(false);
    }
  }, [applicationId, authLoading, currentPage, directEditingMode, itemsPerPage, statusFilter]);

  useEffect(() => {
    if (!authLoading) fetchApplications();
    return () => { loadController.current?.abort(); window.clearTimeout(loadRetry.current); };
  }, [authLoading, fetchApplications]);

  useEffect(() => {
    const query = String(editingApp.name || '').trim();
    if (!editing || query.length < 2 || query === selectedDirectoryName) {
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
  }, [editing, editingApp.name, selectedDirectoryName]);

  const validateField = (name, value) => validateApplicationField(name, value);

  const startEditing = (app) => {
    setEditing(true);
    baselineRef.current = app;
    const draft = readFormDraft(`edit-request:${app.id}`, null);
    const restored = draft && String(draft.id) === String(app.id);
    const stale = Boolean(restored && draft.revision !== app.revision);
    setEditingApp(restored ? draft : { ...app });
    setConflict(stale);
    setNotice(stale ? { text: 'Заявка изменена другим администратором. Загрузите актуальную версию перед сохранением.', type: 'warning' } : null);
    setFieldErrors({});
    setEmployeeHints([]);
    setSelectedDirectoryName('');
  };

  const applyEmployeeHint = (employee) => {
    const name = employee.full_name || '';
    const cabinet = employee.room || employee.department || '';
    const phone = employee.internal_phone || '';
    setEditingApp((prev) => ({ ...prev, name, cabinet, N_tel: phone }));
    setFieldErrors((prev) => ({
      ...prev,
      name: validateField('name', name),
      cabinet: validateField('cabinet', cabinet),
      N_tel: validateField('N_tel', phone)
    }));
    setSelectedDirectoryName(name);
    setEmployeeHints([]);
  };

  const handleChange = (e) => {
    if (savingRef.current) return;
    const { name, value, type, checked } = e.target;
    
    let processedValue = type === 'checkbox' ? checked : value;
    if (name === 'name') setSelectedDirectoryName('');
    
    if (name === 'data') {
      if (value) {
        const date = new Date(value);
        processedValue = date.toISOString().split('T')[0];
      } else {
        processedValue = null;
      }
    } else if (name === 'start_data') {
      if (value) {
        const date = new Date(value);
        const adjustedDate = adjustForNovosibirskTime(date);
        processedValue = adjustedDate.toISOString();
        
        setEditingApp(prev => ({
          ...prev,
          end_data: new Date(adjustedDate.getTime() + 30 * 60000).toISOString()
        }));
      } else {
        processedValue = null;
      }
    }
    
    const error = validateField(name, processedValue);
    setFieldErrors(prev => ({
      ...prev,
      [name]: error
    }));
    
    if (name === 'fl' && checked) {
      // Админ закрыл заявку: фиксируем фактическое время закрытия.
      const now = new Date().toISOString();
      setEditingApp(prev => ({
        ...prev,
        [name]: processedValue,
        end_data: prev.end_data || now,
        employee_confirmed_at: now
      }));
    } else {
      setEditingApp(prev => ({
        ...prev,
        [name]: processedValue
      }));
    }
  };

  const validateForm = () => {
    const next = validateApplication(editingApp);
    setFieldErrors(next); return Object.keys(next).length === 0;
  };

  const saveChanges = async () => {
    if (savingRef.current) return;
    if (!validateForm()) {
      setNotice({ text: 'Пожалуйста, исправьте ошибки в форме', type: 'warning' });
      return;
    }

    savingRef.current = true; setSaving(true);
    try {
      const appToSave = { ...editingApp };

      // Закрытие заявки фиксирует фактическое время закрытия.
      if (appToSave.fl) {
        const now = new Date().toISOString();
        if (!appToSave.end_data) appToSave.end_data = now;
        appToSave.employee_confirmed_at = appToSave.employee_confirmed_at || now;
      }

      const response = await authFetch(`${API_BASE_URL}/applications/${appToSave.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(appToSave)
      });

      if (response.ok) {
        baselineRef.current = appToSave; clearDraft();
        window.dispatchEvent(new Event('applications:refresh'));
        if (directEditingMode) {
          navigate('/');
        } else {
          await fetchApplications();
          setEditing(false);
          setNotice(null);
          setSuccessMessage('Изменения успешно сохранены!');
          setTimeout(() => setSuccessMessage(''), 3000);
        }
      } else {
        const data = await response.json().catch(() => ({}));
        setConflict(response.status === 409);
        if (data.errors) setFieldErrors(data.errors);
        setNotice({ text: data.error || `Ошибка при сохранении: ${response.status}`, type: 'error' });
      }
    } catch (err) {
      console.error('Ошибка:', err.message);
      setNotice({ text: 'Произошла сетевая ошибка при сохранении. Проверьте подключение к серверу.', type: 'error' });
    } finally { savingRef.current = false; setSaving(false); }
  };

  const cancelEditing = () => {
    if (dirty && !window.confirm(t('Отменить несохранённые изменения?'))) return;
    baselineRef.current = null; clearDraft();
    if (directEditingMode) {
      navigate('/');
      return;
    }
    setEditing(false);
    setEditingApp({});
    setFieldErrors({});
    setEmployeeHints([]);
    setSelectedDirectoryName('');
  };

  const deleteApplication = async (id) => {
    if (!window.confirm(t('Вы уверены, что хотите удалить заявку?'))) {
      return;
    }

    try {
      const response = await authFetch(`${API_BASE_URL}/applications/${id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        if (applications.length === 1 && currentPage > 1) {
          setCurrentPage(currentPage - 1);
        } else {
          await fetchApplications();
        }
        setSuccessMessage('Заявка успешно удалена!');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        const errorText = await response.text();
        console.error('Ошибка сервера:', response.status, errorText);
        setNotice({ text: `Ошибка при удалении: ${response.status} ${response.statusText}`, type: 'error' });
      }
    } catch (err) {
      console.error('Ошибка удаления:', err.message);
      setNotice({ text: 'Произошла сетевая ошибка при удалении. Проверьте подключение к серверу.', type: 'error' });
    }
  };

  const getVisiblePages = () => {
    const visiblePages = 6;
    const halfVisible = Math.floor(visiblePages / 2);
    
    let startPage = Math.max(1, currentPage - halfVisible);
    let endPage = Math.min(totalPages, startPage + visiblePages - 1);
    
    if (endPage - startPage + 1 < visiblePages) {
      startPage = Math.max(1, endPage - visiblePages + 1);
    }
    
    return Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
  };

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const goToFirstPage = () => goToPage(1);
  const goToLastPage = () => goToPage(totalPages);
  const goToPrevPage = () => goToPage(currentPage - 1);
  const goToNextPage = () => goToPage(currentPage + 1);

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString(getAdminLocale());
  };

  const getStatusLabel = (app) => {
    if (app.fl) return 'Выполнено';
    const labels = {
      new: 'Новая',
      reopened: 'Переоткрыта',
      accepted: 'Назначена',
      in_progress: 'В работе',
      waiting_employee_confirmation: 'Ждёт подтверждения',
      done: 'Выполнено'
    };
    return labels[app.status] || 'Новая';
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;

    return (
      <div className="pagination">
        <button
          onClick={goToFirstPage}
          disabled={currentPage === 1}
          className="pagination-btn"
          title={t("Первая страница")}
        >
          ««
        </button>
        
        <button
          onClick={goToPrevPage}
          disabled={currentPage === 1}
          className="pagination-btn"
          title={t("Предыдущая страница")}
        >
          «
        </button>

        {getVisiblePages().map(page => (
          <button
            key={page}
            onClick={() => goToPage(page)}
            className={`pagination-btn ${currentPage === page ? 'active' : ''}`}
          >
            {t(page)}
          </button>
        ))}

        <button
          onClick={goToNextPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title={t("Следующая страница")}
        >
          »
        </button>
        
        <button
          onClick={goToLastPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title={t("Последняя страница")}
        >
          »»
        </button>

        <span className="pagination-info">{t("Страница ")}{t(currentPage)}{t(" из ")}{t(totalPages)}
        </span>
      </div>
    );
  };

  const handleItemsPerPageChange = (e) => {
    const value = parseInt(e.target.value);
    setItemsPerPage(value);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (e) => {
    setStatusFilter(e.target.value);
    setCurrentPage(1);
  };

  const handleTooltipMouseMove = (e) => {
    document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
    document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
  };

  if (loading) {
    return (
      <div className="edit-container">
        <div className="loading">{t("Загрузка данных...")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="edit-container">
        <AdminNotice type="error"><span>{t(error)}</span><button onClick={fetchApplications} className="retry-button">{t("Повторить попытку")}</button></AdminNotice>
      </div>
    );
  }

  return (
    <div className="edit-container">
      {!directEditingMode && <div className="edit-header">
        <h2>{t("Редактирование заявок")}</h2>
        <div className="header-actions">
          <button onClick={fetchApplications} className="refresh-button">{t("Обновить")}</button>
          <select
            value={statusFilter}
            onChange={handleStatusFilterChange}
            className="page-size-select"
            title={t("Фильтр по статусу заявки")}
          >
            <option value="all">{t("Все статусы")}</option>
            <option value="queue">{t("Новые")}</option>
            <option value="active">{t("В работе")}</option>
            <option value="confirmation">{t("Ждут подтверждения")}</option>
            <option value="done">{t("Выполненные")}</option>
            <option value="overdue">{t("Просроченные")}</option>
          </select>
          <select
            value={itemsPerPage}
            onChange={handleItemsPerPageChange}
            className="page-size-select"
          >
            <option value={5}>{t("5 на странице")}</option>
            <option value={10}>{t("10 на странице")}</option>
            <option value={20}>{t("20 на странице")}</option>
            <option value={50}>{t("50 на странице")}</option>
          </select>
        </div>
      </div>}

      {error && (
        <AdminNotice type="error"><span>{t(error)}</span><button onClick={fetchApplications} className="retry-button">{t("Повторить попытку")}</button></AdminNotice>
      )}

      {notice && <AdminNotice type={notice.type} onDismiss={() => setNotice(null)} dismissLabel={t("Закрыть уведомление")}>{t(notice.text)}</AdminNotice>}

      {successMessage && (
        <AdminNotice type="success">{t(successMessage)}</AdminNotice>
      )}

      {editing ? (
        <div className="edit-form">
          <h3>{t("Редактирование заявки #")}{editingApp.id}</h3>
          
          <div className="form-section">
            <h4 className="form-section-title">{t("Основная информация")}</h4>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="name" className="required-field">{t("ФИО")}</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={editingApp.name || ''}
                  onChange={handleChange}
                  className={fieldErrors.name ? 'error' : ''}
                  maxLength={40}
                />
                {fieldErrors.name && (
                  <span className="field-error">{t(fieldErrors.name)}</span>
                )}
                <div className="character-count">
                  {editingApp.name?.length || 0}/40
                </div>
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

              <div className="form-group">
                <label htmlFor="cabinet">{t("Кабинет")}</label>
                <input
                  type="text"
                  id="cabinet"
                  name="cabinet"
                  value={editingApp.cabinet || ''}
                  onChange={handleChange}
                  className={fieldErrors.cabinet ? 'error' : ''}
                  maxLength={15}
                />
                {fieldErrors.cabinet && (
                  <span className="field-error">{t(fieldErrors.cabinet)}</span>
                )}
                <div className="character-count">
                  {editingApp.cabinet?.length || 0}/15
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="N_tel">{t("Номер телефона")}</label>
                <input
                  type="text"
                  id="N_tel"
                  name="N_tel"
                  value={editingApp.N_tel || ''}
                  onChange={handleChange}
                  className={fieldErrors.N_tel ? 'error' : ''}
                  maxLength={15}
                />
                {fieldErrors.N_tel && (
                  <span className="field-error">{t(fieldErrors.N_tel)}</span>
                )}
                <div className="character-count">
                  {editingApp.N_tel?.length || 0}/15
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h4 className="form-section-title">{t("Содержание заявки")}</h4>
            <div className="form-grid">
              <div className="form-group full-width">
                <label htmlFor="application" className="required-field">{t("Заявка")}</label>
                <textarea
                  id="application"
                  name="application"
                  value={editingApp.application || ''}
                  onChange={handleChange}
                  className={fieldErrors.application ? 'error' : ''}
                  maxLength={500}
                  rows={4}
                />
                {fieldErrors.application && (
                  <span className="field-error">{t(fieldErrors.application)}</span>
                )}
                <div className="character-count">
                  {editingApp.application?.length || 0}/500
                </div>
              </div>

              <div className="form-group full-width">
                <label htmlFor="process">{t("Процесс выполнения")}</label>
                <textarea
                  id="process"
                  name="process"
                  value={editingApp.process || ''}
                  onChange={handleChange}
                  className={fieldErrors.process ? 'error' : ''}
                  maxLength={1500}
                  rows={6}
                />
                {fieldErrors.process && (
                  <span className="field-error">{t(fieldErrors.process)}</span>
                )}
                <div className="character-count">
                  {editingApp.process?.length || 0}/1500
                </div>
              </div>
            </div>
          </div>

          <div className="form-section status-section">
            <h4 className="form-section-title">{t("Статус выполнения")}</h4>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="executor">{t("Исполнитель")}</label>
                <input
                  type="text"
                  id="executor"
                  name="executor"
                  value={editingApp.executor || ''}
                  onChange={handleChange}
                  className={fieldErrors.executor ? 'error' : ''}
                  maxLength={60}
                />
                {fieldErrors.executor && (
                  <span className="field-error">{t(fieldErrors.executor)}</span>
                )}
                <div className="character-count">
                  {t(editingApp.executor?.length || 0)}/60
                </div>
              </div>

              {/*<div className="form-group">
                <label htmlFor="start_data">Время начала</label>
                <input
                  type="datetime-local"
                  id="start_data"
                  name="start_data"
                  value={formatDateTimeForInput(editingApp.start_data)}
                  onChange={handleChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="end_data">Время завершения</label>
                <input
                  type="datetime-local"
                  id="end_data"
                  name="end_data"
                  value={formatDateTimeForInput(editingApp.end_data)}
                  onChange={handleChange}
                  disabled={!editingApp.fl}
                />
              </div>*/}
			  </div>

            <label className="checkbox-label">
              <input
                type="checkbox"
                name="fl"
                checked={editingApp.fl || false}
                onChange={handleChange}
              />
              <span className="checkbox-custom"></span>{t("Заявка выполнена")}</label>
          </div>

          <div className="form-buttons">
            <button onClick={cancelEditing} disabled={saving} className="cancel-button">{t("Отмена")}</button>
            <button onClick={saveChanges} disabled={saving || conflict} className="save-button">{t(saving ? 'Сохранение...' : 'Сохранить изменения')}</button>
            {conflict && <button type="button" onClick={() => { if (window.confirm(t('Загрузить актуальную заявку? Несохранённые изменения будут отменены.'))) { clearDraft(); fetchApplications(); } }}>{t('Загрузить актуальную версию')}</button>}
          </div>
        </div>
      ) : (
        <>
          <div className="table-info">{t("Показано ")}{applications.length}{t(" из ")}{t(totalItems)}{t(" заявок")}</div>
          
          <div className="table-container">
            <table className="applications-table">
              <thead>
                <tr >
				{/*<th>ID</th>*/}
                  <th>{t("ФИО")}</th>
                  <th>{t("Кабинет")}</th>
                  <th>{t("Телефон")}</th>
                  <th>{t("Заявка")}</th>
                  <th>{t("Процесс")}</th>
                  <th>{t("Дата создания")}</th>
                  <th>{t("Исполнитель")}</th>
                  <th>{t("Статус")}</th>
                  <th>{t("Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {applications.map(app => (
                  <tr key={app.id} className={app.fl ? 'completed' : ''}>
					  {/*<td className="cell-id">{app.id}</td>*/}
                    <td className="cell-name">{app.name}</td>
                    <td>{app.cabinet || '—'}</td>
                    <td>{app.N_tel || '—'}</td>
                    <td 
                      className="cell-application"
                      data-tooltip={app.application}
                      onMouseMove={handleTooltipMouseMove}
                    >
                      {app.application || '—'}
                    </td>
                    <td 
                      className="cell-process"
                      data-tooltip={app.process || t('Информация отсутствует')}
                      onMouseMove={handleTooltipMouseMove}
                    >
                      {app.process || '—'}
                    </td>
                    <td className="cell-date">
                      <div>{t(formatDate(app.data))}</div>
						  {/*<div>{formatTime(app.data)}</div>*/}
                    </td>
                    <td>{t(app.executor || '—')}</td>
                    <td>
                      <span className={`status-badge ${app.fl ? 'completed' : 'pending'}`}>
                        {t(getStatusLabel(app))}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          onClick={() => startEditing(app)}
                          className="edit-button"
                          title={t("Редактировать")}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => deleteApplication(app.id)}
                          className="delete-button"
                          title={t("Удалить")}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {renderPagination()}
        </>
      )}
    </div>
  );
}

export default EditApplicationsTable;
