import React, { useState, useEffect, useCallback } from 'react';
import { searchEmployees, getDepartments, syncEmployees } from '../services/employeeService';
import './EmployeeSearch.css'; // Импортируем CSS файл
//import { API_BASE_URL } from '../config';

const EmployeeSearch = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchField, setSearchField] = useState('full_name');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [results, setResults] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncChanges, setSyncChanges] = useState(null);

  const searchFields = [
    { value: 'full_name', label: 'ФИО' },
    { value: 'position', label: 'Должность' },
    { value: 'department', label: 'Отдел' },
    { value: 'room', label: 'Кабинет' },
    { value: 'internal_phone', label: 'Телефон' },
    { value: 'email', label: 'Email' }
  ];

  const loadDepartments = useCallback(async () => {
    try {
      const depts = await getDepartments();
      setDepartments(depts);
    } catch (err) {
      console.error('Ошибка загрузки отделов:', err);
    }
  }, []);

  // Загружаем отделы при монтировании компонента
  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const handleSearch = async (e) => {
    e.preventDefault();

    // Если выбран фильтр по отделу, используем его
    const actualSearchField = departmentFilter ? 'department' : searchField;
    const actualSearchTerm = departmentFilter || searchTerm;

    if (!actualSearchTerm.trim()) {
      setError('Введите поисковый запрос');
      return;
    }

    setLoading(true);
    setError('');
    setSyncMessage('');
    setSyncChanges(null);

    try {
      const data = await searchEmployees(actualSearchField, actualSearchTerm);
      setResults(data);
    } catch (err) {
      setError(err.message || 'Ошибка при поиске сотрудников');
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setDepartmentFilter('');
    setResults([]);
    setError('');
    setSyncMessage('');
    setSyncChanges(null);
  };

  const handleSync = async () => {
    setSyncLoading(true);
    setError('');
    setSyncMessage('');
    setSyncChanges(null);

    try {
      const data = await syncEmployees();
      const loadedPages = Array.isArray(data.pages) ? data.pages.length : 0;
      setSyncMessage(
        `Справочник обновлён: найдено ${data.parsed}, страниц обработано ${loadedPages}/${data.expectedPages || loadedPages} (последний start=${data.lastStart ?? '—'}), добавлено ${data.inserted}, обновлено ${data.updated}, скрыто ${data.deactivated} ранее активных записей, которых нет в текущем источнике.`
      );
      setSyncChanges(data.changes || null);
      await loadDepartments();
    } catch (err) {
      setError(err.message || 'Ошибка при обновлении справочника сотрудников');
      console.error('Sync error:', err);
    } finally {
      setSyncLoading(false);
    }
  };


  const renderEmployeeCells = (employee = {}) => (
    <>
      <td>{employee.full_name}</td>
      <td>{employee.position}</td>
      <td>{employee.department}</td>
      <td>{employee.room}</td>
      <td>{employee.internal_phone}</td>
      <td>{employee.email || <span className="no-data">-</span>}</td>
    </>
  );

  const renderChangeSection = (title, changeGroup, renderRows) => {
    if (!changeGroup || changeGroup.count === 0) return null;

    return (
      <div className="sync-records-container">
        <h3>{title}: {changeGroup.count}</h3>
        {changeGroup.count > changeGroup.items.length && (
          <p>Показаны первые {changeGroup.items.length} из {changeGroup.count}.</p>
        )}
        <div className="table-container">
          {renderRows(changeGroup.items || [])}
        </div>
      </div>
    );
  };

  const hasSyncChanges = Boolean(
    syncChanges
    && (syncChanges.inserted?.count || syncChanges.updated?.count || syncChanges.deactivated?.count)
  );

  return (
    <div className="employee-search-container">
      <div className="employee-search-header">
        <h1>🔍 Поиск сотрудников</h1>
        <p>Институт органической химии - База данных сотрудников</p>
      </div>

      <form onSubmit={handleSearch} className="search-form">
        <div className="search-grid">
          {/* Поле поиска */}
          <div className="form-group">
            <label>
              Поле для поиска:
            </label>
            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value)}
              disabled={!!departmentFilter}
              className="search-select"
            >
              {searchFields.map(field => (
                <option key={field.value} value={field.value}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>

          {/* Поисковый запрос */}
          <div className="form-group">
            <label>
              Поисковый запрос:
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Введите запрос для поиска..."
              disabled={!!departmentFilter}
              className="search-input"
            />
          </div>

          {/* Фильтр по отделу */}
          <div className="form-group">
            <label>
              Фильтр по отделу:
            </label>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="search-select"
            >
              <option value="">Все отделы</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* Кнопки */}
          <div className="form-buttons">
            <button
              type="submit"
              disabled={loading}
              className="search-button"
            >
              {loading ? '⏳ Поиск...' : '🔍 Найти'}
            </button>

            <button
              type="button"
              onClick={clearFilters}
              className="clear-button"
            >
              🗑️ Очистить
            </button>

            <button
              type="button"
              onClick={handleSync}
              disabled={syncLoading}
              className="sync-button"
            >
              {syncLoading ? '⏳ Обновляем...' : '🔄 Обновить справочник'}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {syncMessage && (
        <div className="sync-message">
          {syncMessage}
        </div>
      )}

      {hasSyncChanges && (
        <div className="sync-changes-summary">
          {renderChangeSection('Новые сотрудники/записи', syncChanges.inserted, (items) => (
            <table className="results-table sync-records-table">
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Должность</th>
                  <th>Отдел</th>
                  <th>Кабинет</th>
                  <th>Телефон вн.</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {items.map((employee) => (
                  <tr key={employee.source_key || `${employee.full_name}-${employee.department}-${employee.room}`}>
                    {renderEmployeeCells(employee)}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

          {renderChangeSection('Скрыты/ушли из текущего справочника', syncChanges.deactivated, (items) => (
            <table className="results-table sync-records-table">
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Должность</th>
                  <th>Отдел</th>
                  <th>Кабинет</th>
                  <th>Телефон вн.</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {items.map((employee) => (
                  <tr key={employee.source_key || `${employee.full_name}-${employee.department}-${employee.room}`}>
                    {renderEmployeeCells(employee)}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

          {renderChangeSection('Изменённые записи', syncChanges.updated, (items) => (
            <table className="results-table sync-updates-table">
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Отдел</th>
                  <th>Что изменилось</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.after?.source_key || `${item.after?.full_name}-${item.after?.department}`}>
                    <td>{item.after?.full_name}</td>
                    <td>{item.after?.department}</td>
                    <td>
                      {(item.changes || []).map((change) => (
                        <div key={change.field} className="sync-field-change">
                          <strong>{change.label}:</strong> {change.oldValue || '—'} → {change.newValue || '—'}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}

      {results.length > 0 ? (
        <div className="results-container">
          <h3>Найдено сотрудников: {results.length}</h3>
          <div className="table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th>ФИО</th>
                  <th>Должность</th>
                  <th>Отдел</th>
                  <th>Кабинет</th>
                  <th>Телефон</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {results.map((employee, index) => (
                  <tr key={employee.id}>
                    <td>{employee.full_name}</td>
                    <td>{employee.position}</td>
                    <td>{employee.department}</td>
                    <td>{employee.room}</td>
                    <td>{employee.internal_phone}</td>
                    <td>
                      {employee.email ? (
                        <a
                          href={`mailto:${employee.email}`}
                          className="email-link"
                        >
                          {employee.email}
                        </a>
                      ) : (
                        <span className="no-data">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        !loading && (searchTerm || departmentFilter) && (
          <div className="empty-state">
            <p>Сотрудники не найдены. Попробуйте изменить поисковый запрос или фильтры.</p>
          </div>
        )
      )}
    </div>
  );
};

export default EmployeeSearch;
