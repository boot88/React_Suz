import AdminNotice from '../components/AdminNotice';
import { useAdminTranslation } from '../utils/adminTranslation';
import React, { useState, useEffect, useCallback } from 'react';
import { searchEmployees, getDepartments } from '../services/employeeService';
import './EmployeeSearch.css'; // Импортируем CSS файл

const EmployeeSearch = () => {
  const t = useAdminTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchField, setSearchField] = useState('full_name');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [results, setResults] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncChanges, setSyncChanges] = useState(null);

  const searchFields = [
    { value: 'full_name', label: 'ФИО' },
    { value: 'position', label: 'Должность' },
    { value: 'department', label: 'Отдел' },
    { value: 'room', label: 'Кабинет' },
    { value: 'internal_phone', label: 'Телефон внутренний' },
    { value: 'external_phone', label: 'Телефон внешний' },
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

    if (!searchTerm.trim() && !departmentFilter) {
      setError('Введите поисковый запрос');
      return;
    }

    setLoading(true);
    setError('');
    setSyncMessage('');
    setSyncChanges(null);

    try {
      const data = await searchEmployees(searchField, searchTerm.trim(), departmentFilter);
      setResults(data);
      setSearched(true);
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
    setSearched(false);
    setError('');
    setSyncMessage('');
    setSyncChanges(null);
  };



  const renderEmployeeCells = (employee = {}) => (
    <>
      <td>{employee.full_name}</td>
      <td>{employee.position}</td>
      <td>{employee.department}</td>
      <td>{employee.room}</td>
      <td>{employee.internal_phone}</td>
      <td>{employee.external_phone}</td>
      <td>{employee.email || <span className="no-data">-</span>}</td>
    </>
  );

  const renderChangeSection = (title, changeGroup, renderRows) => {
    if (!changeGroup || changeGroup.count === 0) return null;

    return (
      <div className="sync-records-container">
        <h3>{t(title)}: {changeGroup.count}</h3>
        {changeGroup.count > changeGroup.items.length && (
          <p>{t("Показаны первые ")}{changeGroup.items.length}{t(" из ")}{changeGroup.count}.</p>
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
        <h1>{t("🔍 Поиск сотрудников")}</h1>
        <p>{t("Институт органической химии - База данных сотрудников")}</p>
      </div>

      <form onSubmit={handleSearch} className="search-form">
        <div className="search-grid">
          {/* Поле поиска */}
          <div className="form-group">
            <label htmlFor="employee-search-field">{t("Поле для поиска:")}</label>
            <select
              id="employee-search-field"
              value={searchField}
              onChange={(e) => setSearchField(e.target.value)}
              className="search-select"
            >
              {searchFields.map(field => (
                <option key={field.value} value={field.value}>
                  {t(field.label)}
                </option>
              ))}
            </select>
          </div>

          {/* Поисковый запрос */}
          <div className="form-group">
            <label htmlFor="employee-search-query">{t("Поисковый запрос:")}</label>
            <input
              type="text"
              id="employee-search-query"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t("Введите запрос для поиска...")}
              className="search-input"
            />
          </div>

          {/* Фильтр по отделу */}
          <div className="form-group">
            <label htmlFor="employee-search-department">{t("Фильтр по отделу:")}</label>
            <select
              id="employee-search-department"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="search-select"
            >
              <option value="">{t("Все отделы")}</option>
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
              {t(loading ? '⏳ Поиск...' : '🔍 Найти')}
            </button>

            <button
              type="button"
              onClick={clearFilters}
              className="clear-button"
            >{t("🗑️ Очистить")}</button>

          </div>
        </div>
      </form>

      {error && (
        <AdminNotice type="error">{t(error)}</AdminNotice>
      )}

      {syncMessage && (
        <AdminNotice type="success">{t(syncMessage)}</AdminNotice>
      )}

      {hasSyncChanges && (
        <div className="sync-changes-summary">
          {renderChangeSection('Новые сотрудники/записи', syncChanges.inserted, (items) => (
            <table className="results-table sync-records-table">
              <thead>
                <tr>
                  <th>{t("ФИО")}</th>
                  <th>{t("Должность")}</th>
                  <th>{t("Отдел")}</th>
                  <th>{t("Кабинет")}</th>
                  <th>{t("Телефон вн.")}</th>
                  <th>{t("Телефон внешний")}</th>
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
                  <th>{t("ФИО")}</th>
                  <th>{t("Должность")}</th>
                  <th>{t("Отдел")}</th>
                  <th>{t("Кабинет")}</th>
                  <th>{t("Телефон вн.")}</th>
                  <th>{t("Телефон внешний")}</th>
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
                  <th>{t("ФИО")}</th>
                  <th>{t("Отдел")}</th>
                  <th>{t("Что изменилось")}</th>
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
                          <strong>{t(change.label)}:</strong> {change.oldValue || '—'} → {change.newValue || '—'}
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
          <h3>{t("Найдено сотрудников: ")}{results.length}</h3>
          <div className="table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th>{t("ФИО")}</th>
                  <th>{t("Должность")}</th>
                  <th>{t("Отдел")}</th>
                  <th>{t("Кабинет")}</th>
                  <th>{t("Телефон внутренний")}</th>
                  <th>{t("Телефон внешний")}</th>
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
                    <td>{employee.external_phone}</td>
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
        !loading && !error && searched && (
          <div className="empty-state">
            <p>{t("Сотрудники не найдены. Попробуйте изменить поисковый запрос или фильтры.")}</p>
          </div>
        )
      )}
    </div>
  );
};

export default EmployeeSearch;
