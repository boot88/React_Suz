import React, { useState, useEffect, useCallback } from 'react';
import './EditApplicationsTable.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

function EditApplicationsTable() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editingApp, setEditingApp] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [statusFilter, setStatusFilter] = useState('all');

  const adjustForNovosibirskTime = (date) => {
    const localDate = new Date(date);
    const timezoneOffset = localDate.getTimezoneOffset() + 420;
    return new Date(localDate.getTime() + timezoneOffset * 60000);
  };

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusQuery = statusFilter !== 'all' ? `&status=${encodeURIComponent(statusFilter)}` : '';
      const response = await authFetch(
        `${API_BASE_URL}/applications?page=${currentPage}&limit=${itemsPerPage}${statusQuery}`
      );
      
      if (!response.ok) {
        throw new Error(`Ошибка сервера: ${response.statusText}`);
      }
      
      const data = await response.json();
      setApplications(data.applications || []);
      setTotalPages(data.totalPages || 1);
      setTotalItems(data.total ?? data.stats?.total ?? 0);
      setLoading(false);
    } catch (err) {
      console.error('Ошибка загрузки:', err.message);
      setError('Не удалось загрузить данные. Проверьте подключение к серверу.');
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, statusFilter]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const validateField = (name, value) => {
    let error = '';
    
    switch(name) {
      case 'name':
        if (!value || value.trim() === '') {
          error = 'ФИО обязательно для заполнения';
        } else if (value.length > 40) {
          error = 'Максимум 40 символов';
        } else if (!/^[а-яА-ЯёЁ\s]+$/.test(value)) {
          error = 'Только русские буквы и пробелы';
        }
        break;
        
      case 'cabinet':
        if (value && value.length > 15) {
          error = 'Максимум 15 символов';
        } else if (value && !/^[а-яА-ЯёЁ0-9\s,-]+$/.test(value)) {
          error = 'Только цифры, русские буквы, пробелы, запятые, дефис';
        }
        break;
        
      case 'N_tel':
        if (value && value.length > 15) {
          error = 'Максимум 15 символов';
        } else if (value && !/^[0-9\s,-]+$/.test(value)) {
          error = 'Только цифры, пробел, запятые и дефис';
        }
        break;
        
      case 'application':
        if (!value || value.trim() === '') {
          error = 'Заявка обязательна для заполнения';
        } else if (value.length > 500) {
          error = 'Максимум 500 символов';
        }
        break;
        
      case 'process':
        if (value && value.length > 1500) {
          error = 'Максимум 1500 символов';
        }
        break;
        
      case 'executor':
        if (value && value.length > 60) {
          error = 'Максимум 60 символов';
        } else if (value && !/^[а-яА-ЯёЁ\s,.]+$/.test(value)) {
          error = 'Только русские буквы, пробелы, запятые, точка';
        }
        break;
        
      default:
        break;
    }
    
    return error;
  };

  const startEditing = (app) => {
    setEditing(true);
    setEditingApp({...app});
    setFieldErrors({});
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    let processedValue = type === 'checkbox' ? checked : value;
    
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
      const now = new Date();
      const startDate = new Date(editingApp.start_data || now);
      const plannedEndDate = new Date(startDate.getTime() + 30 * 60000);
      
      const actualEndDate = now > plannedEndDate ? now : plannedEndDate;
      
      setEditingApp(prev => ({
        ...prev,
        [name]: processedValue,
        end_data: actualEndDate.toISOString()
      }));
    } else {
      setEditingApp(prev => ({
        ...prev,
        [name]: processedValue
      }));
    }
  };

  const validateForm = () => {
    const errors = {};
    let isValid = true;
    
    const nameError = validateField('name', editingApp.name);
    if (nameError) {
      errors.name = nameError;
      isValid = false;
    }
    
    const applicationError = validateField('application', editingApp.application);
    if (applicationError) {
      errors.application = applicationError;
      isValid = false;
    }
    
    const cabinetError = validateField('cabinet', editingApp.cabinet);
    if (cabinetError) errors.cabinet = cabinetError;
    
    const telError = validateField('N_tel', editingApp.N_tel);
    if (telError) errors.N_tel = telError;
    
    const processError = validateField('process', editingApp.process);
    if (processError) errors.process = processError;
    
    const executorError = validateField('executor', editingApp.executor);
    if (executorError) errors.executor = executorError;
    
    setFieldErrors(errors);
    return isValid;
  };

  const saveChanges = async () => {
    if (!validateForm()) {
      alert('Пожалуйста, исправьте ошибки в форме');
      return;
    }

    try {
      const appToSave = { ...editingApp };
      
      if (!appToSave.end_data && appToSave.start_data) {
        const startDate = new Date(appToSave.start_data);
        const endDate = new Date(startDate.getTime() + 30 * 60000);
        appToSave.end_data = endDate.toISOString();
      } else if (!appToSave.end_data) {
        const now = new Date();
        const endDate = new Date(now.getTime() + 30 * 60000);
        appToSave.end_data = endDate.toISOString();
      }

      if (appToSave.fl && appToSave.start_data && appToSave.end_data) {
        const startDate = new Date(appToSave.start_data);
        const endDate = new Date(appToSave.end_data);
        const minimumEndDate = new Date(startDate.getTime() + 30 * 60000);
        if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate < minimumEndDate) {
          appToSave.end_data = minimumEndDate.toISOString();
        }
      }

      const response = await authFetch(`${API_BASE_URL}/applications/${appToSave.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(appToSave)
      });

      if (response.ok) {
        await fetchApplications();
        setEditing(false);
        setSuccessMessage('Изменения успешно сохранены!');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        const errorText = await response.text();
        console.error('Ошибка сервера:', response.status, errorText);
        alert(`Ошибка при сохранении: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('Ошибка:', err.message);
      alert('Произошла сетевая ошибка при сохранении. Проверьте подключение к серверу.');
    }
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditingApp({});
    setFieldErrors({});
  };

  const deleteApplication = async (id) => {
    if (!window.confirm('Вы уверены, что хотите удалить заявку?')) {
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
        alert(`Ошибка при удалении: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('Ошибка удаления:', err.message);
      alert('Произошла сетевая ошибка при удалении. Проверьте подключение к серверу.');
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
    return new Date(dateString).toLocaleDateString('ru-RU');
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
          title="Первая страница"
        >
          ««
        </button>
        
        <button
          onClick={goToPrevPage}
          disabled={currentPage === 1}
          className="pagination-btn"
          title="Предыдущая страница"
        >
          «
        </button>

        {getVisiblePages().map(page => (
          <button
            key={page}
            onClick={() => goToPage(page)}
            className={`pagination-btn ${currentPage === page ? 'active' : ''}`}
          >
            {page}
          </button>
        ))}

        <button
          onClick={goToNextPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title="Следующая страница"
        >
          »
        </button>
        
        <button
          onClick={goToLastPage}
          disabled={currentPage === totalPages}
          className="pagination-btn"
          title="Последняя страница"
        >
          »»
        </button>

        <span className="pagination-info">
          Страница {currentPage} из {totalPages}
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
        <div className="loading">Загрузка данных...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="edit-container">
        <div className="error-message">
          <span>{error}</span>
          <button onClick={fetchApplications} className="retry-button">
            Повторить попытку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="edit-container">
      <div className="edit-header">
        <h2>Редактирование заявок</h2>
        <div className="header-actions">
          <button onClick={fetchApplications} className="refresh-button">
            Обновить
          </button>
          <select
            value={statusFilter}
            onChange={handleStatusFilterChange}
            className="page-size-select"
            title="Фильтр по статусу заявки"
          >
            <option value="all">Все статусы</option>
            <option value="queue">Новые</option>
            <option value="active">В работе</option>
            <option value="confirmation">Ждут подтверждения</option>
            <option value="done">Выполненные</option>
            <option value="overdue">Просроченные</option>
          </select>
          <select
            value={itemsPerPage}
            onChange={handleItemsPerPageChange}
            className="page-size-select"
          >
            <option value={5}>5 на странице</option>
            <option value={10}>10 на странице</option>
            <option value={20}>20 на странице</option>
            <option value={50}>50 на странице</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <span>{error}</span>
          <button onClick={fetchApplications} className="retry-button">
            Повторить попытку
          </button>
        </div>
      )}

      {successMessage && (
        <div className="success-message">
          {successMessage}
        </div>
      )}

      {editing ? (
        <div className="edit-form">
          <h3>Редактирование заявки #{editingApp.id}</h3>
          
          <div className="form-section">
            <h4 className="form-section-title">Основная информация</h4>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="name" className="required-field">ФИО</label>
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
                  <span className="field-error">{fieldErrors.name}</span>
                )}
                <div className="character-count">
                  {editingApp.name?.length || 0}/40
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="cabinet">Кабинет</label>
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
                  <span className="field-error">{fieldErrors.cabinet}</span>
                )}
                <div className="character-count">
                  {editingApp.cabinet?.length || 0}/15
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="N_tel">Номер телефона</label>
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
                  <span className="field-error">{fieldErrors.N_tel}</span>
                )}
                <div className="character-count">
                  {editingApp.N_tel?.length || 0}/15
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h4 className="form-section-title">Содержание заявки</h4>
            <div className="form-grid">
              <div className="form-group full-width">
                <label htmlFor="application" className="required-field">Заявка</label>
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
                  <span className="field-error">{fieldErrors.application}</span>
                )}
                <div className="character-count">
                  {editingApp.application?.length || 0}/500
                </div>
              </div>

              <div className="form-group full-width">
                <label htmlFor="process">Процесс выполнения</label>
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
                  <span className="field-error">{fieldErrors.process}</span>
                )}
                <div className="character-count">
                  {editingApp.process?.length || 0}/1500
                </div>
              </div>
            </div>
          </div>

          <div className="form-section status-section">
            <h4 className="form-section-title">Статус выполнения</h4>
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="executor">Исполнитель</label>
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
                  <span className="field-error">{fieldErrors.executor}</span>
                )}
                <div className="character-count">
                  {editingApp.executor?.length || 0}/60
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
              <span className="checkbox-custom"></span>
              Заявка выполнена
            </label>
          </div>

          <div className="form-buttons">
            <button onClick={cancelEditing} className="cancel-button">
              Отмена
            </button>
            <button onClick={saveChanges} className="save-button">
              Сохранить изменения
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="table-info">
            Показано {applications.length} из {totalItems} заявок
          </div>
          
          <div className="table-container">
            <table className="applications-table">
              <thead>
                <tr >
				{/*<th>ID</th>*/}
                  <th>ФИО</th>
                  <th>Кабинет</th>
                  <th>Телефон</th>
                  <th>Заявка</th>
                  <th>Процесс</th>
                  <th>Дата создания</th>
                  <th>Исполнитель</th>
                  <th>Статус</th>
                  <th>Действия</th>
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
                      data-tooltip={app.process || 'Информация отсутствует'}
                      onMouseMove={handleTooltipMouseMove}
                    >
                      {app.process || '—'}
                    </td>
                    <td className="cell-date">
                      <div>{formatDate(app.data)}</div>
						  {/*<div>{formatTime(app.data)}</div>*/}
                    </td>
                    <td>{app.executor || '—'}</td>
                    <td>
                      <span className={`status-badge ${app.fl ? 'completed' : 'pending'}`}>
                        {getStatusLabel(app)}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          onClick={() => startEditing(app)}
                          className="edit-button"
                          title="Редактировать"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => deleteApplication(app.id)}
                          className="delete-button"
                          title="Удалить"
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
