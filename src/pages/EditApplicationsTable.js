import React, { useState, useEffect, useCallback } from 'react';
import './EditApplicationsTable.css';
import { API_BASE_URL } from '../utils/apiConfig';

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

  // Функция для загрузки данных
  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/applications?page=${currentPage}&limit=${itemsPerPage}`
      );
      
      if (!response.ok) {
        throw new Error(`Ошибка сервера: ${response.statusText}`);
      }
      
      const data = await response.json();
      setApplications(data.applications || []);
      setTotalPages(data.totalPages || 1);
      setTotalItems(data.stats?.total || 0);
      setLoading(false);
    } catch (err) {
      console.error('Ошибка загрузки:', err.message);
      setError('Не удалось загрузить данные. Проверьте подключение к серверу.');
      setLoading(false);
    }
  }, [currentPage, itemsPerPage]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Валидация полей
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
        } else if (value && !/^[а-яА-ЯёЁ0-9\s,\-]+$/.test(value)) {
          error = 'Только цифры, русские буквы, пробелы, запятые, дефис';
        }
        break;
        
      case 'N_tel':
        if (value && value.length > 15) {
          error = 'Максимум 15 символов';
        } else if (value && !/^[0-9\s\-]+$/.test(value)) {
          error = 'Только цифры, пробел и дефис';
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
        } else if (value && !/^[а-яА-ЯёЁ\s,\.]+$/.test(value)) {
          error = 'Только русские буквы, пробелы, запятые, точка';
        }
        break;
        
      default:
        break;
    }
    
    return error;
  };

  // Начало редактирования записи
  const startEditing = (app) => {
    setEditing(true);
    setEditingApp({...app});
    setFieldErrors({});
  };

  // Обработчик изменения полей с валидацией
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    let processedValue = type === 'checkbox' ? checked : value;
    
    // Обработка полей даты
    if (name === 'data') {
      // Для даты подачи сохраняем только дату (без времени)
      if (value) {
        const date = new Date(value);
        processedValue = date.toISOString().split('T')[0];
      } else {
        processedValue = null;
      }
    } else if (name === 'start_data' || name === 'end_data') {
      // Для даты начала/окончания сохраняем дату и время
      if (value) {
        const date = new Date(value);
        processedValue = date.toISOString();
      } else {
        processedValue = null;
      }
    }
    
    // Валидация поля
    const error = validateField(name, processedValue);
    setFieldErrors(prev => ({
      ...prev,
      [name]: error
    }));
    
    setEditingApp(prev => ({
      ...prev,
      [name]: processedValue
    }));
  };

  // Проверка всей формы перед отправкой
  const validateForm = () => {
    const errors = {};
    let isValid = true;
    
    // Проверяем обязательные поля
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
    
    // Проверяем необязательные поля
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

  // Сохранение изменений
  const saveChanges = async () => {
    if (!validateForm()) {
      alert('Пожалуйста, исправьте ошибки в форме');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/applications/${editingApp.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingApp)
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

  // Отмена редактирования
  const cancelEditing = () => {
    setEditing(false);
    setEditingApp({});
    setFieldErrors({});
  };

  // Удаление записи
  const deleteApplication = async (id) => {
    if (!window.confirm('Вы уверены, что хотите удалить заявку?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/applications/${id}`, {
        method: 'DELETE',
        headers: { 
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Если удаляем последний элемент на странице, переходим на предыдущую
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

  // Функция для преобразования даты в формат YYYY-MM-DD (без времени)
  const formatDateForInput = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
  };

  // Функция для преобразования даты и времени в формат для input[type="datetime-local"]
  const formatDateTimeForInput = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    
    // Корректируем смещение времени (убираем смещение на 17 часов)
    const correctedDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    
    return correctedDate.toISOString().slice(0, 16);
  };

  // Пагинация (как в Dashboard)
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

  // Форматирование даты для отображения
  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('ru-RU');
  };

  // Форматирование времени для отображения
  const formatTime = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Рендер пагинации (как в Dashboard)
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

        {getVisiblePages().map((page) => (
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

  if (loading && applications.length === 0) {
    return <div className="loading">Загрузка...</div>;
  }

  return (
    <div className="edit-container">
      <div className="edit-header">
        <h2>Управление заявками</h2>
        <div className="header-actions">
          <button onClick={fetchApplications} className="refresh-button">
            Обновить
          </button>
          <select
            value={itemsPerPage}
            onChange={(e) => {
              setItemsPerPage(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="page-size-select"
          >
            <option value={5}>5 записей</option>
            <option value={10}>10 записей</option>
            <option value={20}>20 записей</option>
            <option value={50}>50 записей</option>
            <option value={100}>100 записей</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={fetchApplications} className="retry-button">Повторить попытку</button>
        </div>
      )}

      {successMessage && (
        <div className="success-message">{successMessage}</div>
      )}

      {editing ? (
        <div className="edit-form">
          <h3>Редактирование заявки #{editingApp.id}</h3>
          <form onSubmit={(e) => { e.preventDefault(); saveChanges(); }}>
            <div className="form-grid">
              <div className="form-group">
                <label>ФИО научного сотрудника *</label>
                <input 
                  type="text" 
                  name="name" 
                  value={editingApp.name || ''} 
                  onChange={handleChange} 
                  maxLength={40}
                  className={fieldErrors.name ? 'error' : ''}
                  required
                />
                {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
                <div className="character-count">{(editingApp.name || '').length}/40</div>
              </div>
              
              <div className="form-group">
                <label>Лаборатория/Кабинет</label>
                <input 
                  type="text" 
                  name="cabinet" 
                  value={editingApp.cabinet || ''} 
                  onChange={handleChange} 
                  maxLength={15}
                  className={fieldErrors.cabinet ? 'error' : ''}
                />
                {fieldErrors.cabinet && <span className="field-error">{fieldErrors.cabinet}</span>}
                <div className="character-count">{(editingApp.cabinet || '').length}/15</div>
              </div>
              
              <div className="form-group">
                <label>Внутренний телефон</label>
                <input 
                  type="text" 
                  name="N_tel" 
                  value={editingApp.N_tel || ''} 
                  onChange={handleChange} 
                  maxLength={15}
                  className={fieldErrors.N_tel ? 'error' : ''}
                />
                {fieldErrors.N_tel && <span className="field-error">{fieldErrors.N_tel}</span>}
                <div className="character-count">{(editingApp.N_tel || '').length}/15</div>
              </div>
              
              <div className="form-group full-width">
                <label>Суть заявки *</label>
                <textarea 
                  name="application" 
                  value={editingApp.application || ''} 
                  onChange={handleChange}
                  rows="3"
                  maxLength={500}
                  className={fieldErrors.application ? 'error' : ''}
                  required
                />
                <div className="character-count">{(editingApp.application || '').length}/500</div>
                {fieldErrors.application && <span className="field-error">{fieldErrors.application}</span>}
              </div>
              
              <div className="form-group full-width">
                <label>Выполненные работы</label>
                <textarea 
                  name="process" 
                  value={editingApp.process || ''} 
                  onChange={handleChange}
                  rows="3"
                  maxLength={1500}
                  className={fieldErrors.process ? 'error' : ''}
                />
                <div className="character-count">{(editingApp.process || '').length}/1500</div>
                {fieldErrors.process && <span className="field-error">{fieldErrors.process}</span>}
              </div>
              
              <div className="form-group">
                <label>Исполнитель</label>
                <input 
                  type="text" 
                  name="executor" 
                  value={editingApp.executor || ''} 
                  onChange={handleChange} 
                  maxLength={60}
                  className={fieldErrors.executor ? 'error' : ''}
                />
                {fieldErrors.executor && <span className="field-error">{fieldErrors.executor}</span>}
                <div className="character-count">{(editingApp.executor || '').length}/60</div>
              </div>
              
              <div className="form-group">
                <label>Дата подачи</label>
                <input 
                  type="date" 
                  name="data" 
                  value={formatDateForInput(editingApp.data)} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group">
                <label>Дата начала</label>
                <input 
                  type="datetime-local" 
                  name="start_data" 
                  value={formatDateTimeForInput(editingApp.start_data)} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group">
                <label>Дата окончания</label>
                <input 
                  type="datetime-local" 
                  name="end_data" 
                  value={formatDateTimeForInput(editingApp.end_data)} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group checkbox-group">
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
            </div>
            
            <div className="form-buttons">
              <button type="submit" className="save-button">Сохранить изменения</button>
              <button type="button" onClick={cancelEditing} className="cancel-button">Отменить</button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {applications.length === 0 ? (
            <div className="empty-state">
              <p>Нет доступных заявок</p>
              <button onClick={fetchApplications} className="retry-button">Обновить</button>
            </div>
          ) : (
            <>
              <div className="table-info">
                Показано {applications.length} из {totalItems} записей
              </div>
              
              <div className="table-container">
                <table className="applications-table">
                  <thead>
                    <tr>
                      <th>Клиент</th>
                      <th>Кабинет</th>
                      <th>Телефон</th>
                      <th>Заявка</th>
                      <th>Процесс</th>
                      <th>Исполнитель</th>
                      <th>Дата подачи</th>
                      <th>Начало</th>
                      <th>Окончание</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map(app => (
                      <tr key={app.id} className={app.fl ? 'completed' : ''}>
                        <td className="cell-name">{app.name}</td>
                        <td>{app.cabinet || '—'}</td>
                        <td>{app.N_tel || '—'}</td>
                        
						
						<td 
                             className="cell-application" 
                             data-tooltip={app.application}
                             onMouseMove={(e) => {
    // Сохраняем позицию курсора для позиционирования тултипа
                             document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
                             document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
                        }}
                        >
                             {app.application}
                        </td>
                        <td 
                              className="cell-process" 
                              data-tooltip={app.process || 'Информация отсутствует'}
                              onMouseMove={(e) => {
                              document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
                              document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);
                        }}
                        >
                             {app.process || '—'}
                        </td>
                        
						
						<td>{app.executor || '—'}</td>
                        <td className="cell-date">{formatDate(app.data)}</td>
                        <td className="cell-date">{formatTime(app.start_data)}</td>
                        <td className="cell-date">{formatTime(app.end_data)}</td>
                        <td>
                          <span className={`status-badge ${app.fl ? 'completed' : 'pending'}`}>
                            {app.fl ? '✅ Выполнено' : '⏳ В процессе'}
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

              {/* Пагинация (как в Dashboard) */}
              {renderPagination()}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default EditApplicationsTable;