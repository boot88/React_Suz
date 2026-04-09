import React, { useState, useEffect } from 'react';
import { searchEmployees, getDepartments } from '../services/employeeService';
import './EmployeeSearch.css'; // Импортируем CSS файл
//import { API_BASE_URL } from '../config';

const EmployeeSearch = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchField, setSearchField] = useState('full_name');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [results, setResults] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchFields = [
    { value: 'full_name', label: 'ФИО' },
    { value: 'position', label: 'Должность' },
    { value: 'department', label: 'Отдел' },
    { value: 'room', label: 'Кабинет' },
    { value: 'internal_phone', label: 'Телефон' },
    { value: 'email', label: 'Email' }
  ];

  // Загружаем отделы при монтировании компонента
  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const depts = await getDepartments();
        setDepartments(depts);
      } catch (err) {
        console.error('Ошибка загрузки отделов:', err);
      }
    };

    loadDepartments();
  }, []);

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
  };

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
          </div>
        </div>
      </form>

      {error && (
        <div className="error-message">
          {error}
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