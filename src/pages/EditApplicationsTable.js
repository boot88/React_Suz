import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './EditApplicationsTable.css';

function EditApplicationsTable() {
  const navigate = useNavigate();
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

  const API_BASE_URL = 'http://localhost:5000/api';

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
  }, [currentPage, itemsPerPage, API_BASE_URL]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Начало редактирования записи
  const startEditing = (app) => {
    setEditing(true);
    setEditingApp({...app});
  };

  // Сохранение изменений
  const saveChanges = async () => {
    try {
      if (!editingApp.id || !editingApp.name || !editingApp.name.trim()) {
        alert('Имя клиента не может быть пустым');
        return;
      }

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

  // Обработчик изменения полей
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    let processedValue = type === 'checkbox' ? checked : value;
    
    if (name === 'data' || name === 'start_data' || name === 'end_data') {
      if (value) {
        processedValue = new Date(value).toISOString();
      } else {
        processedValue = null;
      }
    }
    
    setEditingApp(prev => ({
      ...prev,
      [name]: processedValue
    }));
  };

  // Пагинация
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

  // Форматирование даты
  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
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
                <label>ID:</label>
                <input type="text" value={editingApp.id} disabled />
              </div>
              
              <div className="form-group">
                <label>Клиент *</label>
                <input 
                  type="text" 
                  name="name" 
                  value={editingApp.name || ''} 
                  onChange={handleChange} 
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Кабинет</label>
                <input 
                  type="text" 
                  name="cabinet" 
                  value={editingApp.cabinet || ''} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group">
                <label>Телефон</label>
                <input 
                  type="text" 
                  name="N_tel" 
                  value={editingApp.N_tel || ''} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group">
                <label>Процесс</label>
                <input 
                  type="text" 
                  name="process" 
                  value={editingApp.process || ''} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group">
                <label>Исполнитель</label>
                <input 
                  type="text" 
                  name="executor" 
                  value={editingApp.executor || ''} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group full-width">
                <label>Заявка *</label>
                <textarea 
                  name="application" 
                  value={editingApp.application || ''} 
                  onChange={handleChange}
                  rows="3"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Дата подачи</label>
                <input 
                  type="datetime-local" 
                  name="data" 
                  value={editingApp.data ? new Date(editingApp.data).toISOString().slice(0, 16) : ''} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group">
                <label>Дата начала</label>
                <input 
                  type="datetime-local" 
                  name="start_data" 
                  value={editingApp.start_data ? new Date(editingApp.start_data).toISOString().slice(0, 16) : ''} 
                  onChange={handleChange} 
                />
              </div>
              
              <div className="form-group">
                <label>Дата окончания</label>
                <input 
                  type="datetime-local" 
                  name="end_data" 
                  value={editingApp.end_data ? new Date(editingApp.end_data).toISOString().slice(0, 16) : ''} 
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
                      <th>ID</th>
                      <th>Клиент</th>
                      <th>Кабинет</th>
                      <th>Телефон</th>
                      <th>Заявка</th>
                      <th>Процесс</th>
                      <th>Исполнитель</th>
                      <th>Дата подачи</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map(app => (
                      <tr key={app.id} className={app.fl ? 'completed' : ''}>
                        <td className="cell-id">{app.id}</td>
                        <td className="cell-name">{app.name}</td>
                        <td>{app.cabinet || '—'}</td>
                        <td>{app.N_tel || '—'}</td>
                        <td className="cell-application">{app.application || '—'}</td>
                        <td className="cell-process">{app.process || '—'}</td>
                        <td>{app.executor || '—'}</td>
                        <td className="cell-date">{formatDate(app.data)}</td>
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

              {/* Пагинация */}
              {totalPages > 1 && (
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
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default EditApplicationsTable;