import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import './Dashboard.css';
import { API_BASE_URL } from '../utils/apiConfig';

const Dashboard = () => {
  const [applications, setApplications] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [exportLoading, setExportLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);

  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
  });

  const [filteredStats, setFilteredStats] = useState({
    total: 0,
    completed: 0,
    pending: 0,
  });

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateFilterActive, setDateFilterActive] = useState(false);

  const exportToExcel = async () => {
    setExportLoading(true);
    try {
      let url = '/applications/export';
      if (filter === 'done') url += '?status=done';
      if (filter === 'pending') url += '?status=pending';
      if (fromDate) url += `${url.includes('?') ? '&' : '?'}from=${fromDate}`;
      if (toDate) url += `${url.includes('?') ? '&' : '?'}to=${toDate}`;
      if (searchTerm) url += `${url.includes('?') ? '&' : '?'}search=${encodeURIComponent(searchTerm.trim())}`;

      const response = await fetch(`${API_BASE_URL}${url}`);
      const data = await response.json();
      const allApplications = data.applications || [];

      if (allApplications.length === 0) {
        alert('Нет данных для экспорта');
        return;
      }

      const excelData = allApplications.map(app => ({
        'ID': app.id,
        'Клиент': app.name,
        'Кабинет': app.cabinet || '',
        'Телефон': app.N_tel || '',
        'Заявка': app.application,
        'Что сделано': app.process || '',
        'Исполнитель': app.executor || '',
        'Дата подачи': app.data ? new Date(app.data).toLocaleString('ru-RU') : '',
        'Дата начала': app.start_data ? new Date(app.start_data).toLocaleString('ru-RU') : '',
        'Дата окончания': app.end_data ? new Date(app.end_data).toLocaleString('ru-RU') : '',
        'Статус': app.fl ? 'Выполнено' : 'В работе'
      }));

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);

      const colWidths = [
        { wch: 8 },  { wch: 20 }, { wch: 10 }, { wch: 15 },
        { wch: 30 }, { wch: 30 }, { wch: 15 }, { wch: 20 },
        { wch: 20 }, { wch: 20 }, { wch: 12 }
      ];
      worksheet['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Заявки');

      const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
      const fileName = searchTerm 
        ? `заявки_поиск_${searchTerm}_${date}.xlsx`
        : `все_заявки_${date}.xlsx`;

      XLSX.writeFile(workbook, fileName);
      alert(`Данные успешно экспортированы в файл: ${fileName}`);

    } catch (error) {
      console.error('Ошибка при экспорте:', error);
      alert('Произошла ошибка при экспорте данных');
    } finally {
      setExportLoading(false);
    }
  };

  const fetchGeneralStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/applications?limit=1`);
      const data = await response.json();
      setStats(data.stats || { total: 0, completed: 0, pending: 0 });
    } catch (error) {
      console.error('Ошибка загрузки статистики:', error);
    }
  };

  const fetchApplications = async () => {
    setLoading(true);
    try {
      let url = `/applications?page=${currentPage}&limit=${limit}`;
      
      if (searchTerm.trim()) {
        url += `&search=${encodeURIComponent(searchTerm.trim())}`;
      }
      
      if (dateFilterActive) {
        if (filter === 'done') url += '&status=done';
        if (filter === 'pending') url += '&status=pending';
        if (fromDate) url += `&from=${fromDate}`;
        if (toDate) url += `&to=${toDate}`;
      } else {
        if (filter === 'done') url += '&status=done';
        if (filter === 'pending') url += '&status=pending';
      }

      const response = await fetch(`${API_BASE_URL}${url}`);
      const data = await response.json();

      setApplications(data.applications || []);
      setTotalPages(data.totalPages || 1);
      setFilteredStats(data.stats || { total: 0, completed: 0, pending: 0 });
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      alert('Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const clearSearch = () => {
    setSearchTerm('');
    setCurrentPage(1);
  };

  useEffect(() => {
    fetchGeneralStats();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchApplications();
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, limit, filter, fromDate, toDate, dateFilterActive, searchTerm]);

  const setFilterAndResetPage = (newFilter) => {
    setFilter(newFilter);
    setCurrentPage(1);
    setSearchTerm('');
    setDateFilterActive(false);
  };

  const applyFilters = () => {
    setCurrentPage(1);
    setDateFilterActive(true);
    setSearchTerm('');
  };

  const clearFilters = () => {
    setFilter('all');
    setFromDate('');
    setToDate('');
    setCurrentPage(1);
    setDateFilterActive(false);
    setSearchTerm('');
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

  const formatTime = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusLabel = (fl) => {
    return fl ? (
      <span className="status-completed">
        <span className="status-icon">✅</span>
        Выполнено
      </span>
    ) : (
      <span className="status-pending">
        <span className="status-icon">🔄</span>
        В работе
      </span>
    );
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

  return (
    <div className="dashboard-container">
      {/* Заголовок */}
      <div className="dashboard-header">
        <h1>⚗️ Панель управления — Заявки</h1>
        <button
          onClick={exportToExcel}
          disabled={exportLoading || stats.total === 0}
          className="export-btn"
          title="Экспортировать данные в Excel"
        >
          {exportLoading ? (
            <>
              <span className="button-spinner"></span>
              Экспорт...
            </>
          ) : (
            <>
              <span className="export-icon">📥</span>
              Экспорт в Excel
            </>
          )}
        </button>
      </div>

      {/* Статистика */}
      <div className="stats-grid">
        <div 
          className={`stat-card ${filter === 'all' && !dateFilterActive && !searchTerm ? 'stat-active' : ''}`}
          onClick={() => {
            setFilterAndResetPage('all');
            setFromDate('');
            setToDate('');
          }}
        >
          <span className="stat-label">📊 Всего заявок</span>
          <div className="stat-number">
            {stats.total}
          </div>
          <small>Всего в системе</small>
        </div>

        <div 
          className={`stat-card stat-completed ${filter === 'done' && !dateFilterActive && !searchTerm ? 'stat-active' : ''}`}
          onClick={() => setFilterAndResetPage('done')}
        >
          <span className="stat-label">✅ Выполнено</span>
          <div className="stat-number">
            {stats.completed}
          </div>
          <small>Успешно закрыто</small>
        </div>

        <div 
          className={`stat-card stat-pending ${filter === 'pending' && !dateFilterActive && !searchTerm ? 'stat-active' : ''}`}
          onClick={() => setFilterAndResetPage('pending')}
        >
          <span className="stat-label">🔄 В работе</span>
          <div className="stat-number">
            {stats.pending}
          </div>
          <small>Требуют внимания</small>
        </div>
      </div>

      {/* Фильтры */}
      <div className="filters-section">
        <div className="filters-group">
          <h3>
            <span className="filter-icon">🔍</span>
            Фильтры и поиск
          </h3>
          <div className="date-filters">
            <div className="filter-group">
              <label>
                <span className="science-icon">📅</span>
                От:
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label>
                <span className="science-icon">📅</span>
                До:
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="filter-actions">
              <button onClick={applyFilters} className="btn-primary">
                <span className="science-icon">✅</span>
                Применить фильтр по дате
              </button>
              <button onClick={clearFilters} className="btn-secondary">
                <span className="science-icon">🔄</span>
                Сбросить все фильтры
              </button>
            </div>
          </div>

          {/* Поиск по заявкам - перемещен сюда для лучшей логической группировки */}
          <div className="filter-group search-container" style={{marginTop: '20px'}}>
            <label>
              <span className="science-icon">🔍</span>
              Поиск по тексту заявки:
              {searchTerm && (
                <span className="search-count">
                  Найдено: {filteredStats.total}
                </span>
              )}
            </label>
            <div className="search-input-container">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Введите слово или фразу (например, 'интернет', 'принтер')"
                className="search-input"
              />
              {searchTerm && (
                <button 
                  onClick={clearSearch} 
                  className="clear-search"
                  title="Очистить поиск"
                >
                  ×
                </button>
              )}
            </div>
            <div className="search-info">
              {searchTerm ? `Поиск по запросу: "${searchTerm}"` : 'Поиск по полю "Заявка"'}
            </div>
          </div>
        </div>

        <div className="filters-group">
          <h3>
            <span className="chart-icon">📊</span>
            Отображение
          </h3>
          <div className="filter-group">
            <label>
              <span className="science-icon">📋</span>
              Показывать:
            </label>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setCurrentPage(1);
              }}
            >
              <option value={5}>5 записей</option>
              <option value={10}>10 записей</option>
              <option value={15}>15 записей</option>
              <option value={20}>20 записей</option>
              <option value={50}>50 записей</option>
            </select>
          </div>
        </div>
      </div>

      {/* Информация о текущем фильтре - теперь перед таблицей */}
      {(filter !== 'all' || dateFilterActive || searchTerm) && (
        <div className="filter-info">
          <strong>Текущий фильтр:</strong> 
          {searchTerm 
            ? ` Поиск: "${searchTerm}" - найдено: ${filteredStats.total} заявок`
            : dateFilterActive 
              ? filter === 'done' 
                ? ` Показаны выполненные заявки за период: ${filteredStats.total} из ${stats.completed}` 
                : filter === 'pending'
                ? ` Показаны заявки в работе за период: ${filteredStats.total} из ${stats.pending}`
                : ` Показаны все заявки за период: ${filteredStats.total} из ${stats.total}`
              : filter === 'done' 
              ? ` Показаны все выполненные заявки: ${filteredStats.total} из ${stats.completed}` 
              : ` Показаны все заявки в работе: ${filteredStats.total} из ${stats.pending}`
          }
          {fromDate && ` с ${fromDate}`}
          {toDate && ` по ${toDate}`}
        </div>
      )}

      {/* Таблица */}
      {loading ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Загрузка данных...</p>
        </div>
      ) : (
        <>
          {/* Заголовок таблицы с информацией о результатах */}
          <div className="table-header">
            <h3>
              <span className="science-icon">📋</span>
              Список заявок
              {applications.length > 0 && (
                <span className="table-count">
                  ({applications.length} из {filteredStats.total})
                </span>
              )}
            </h3>
          </div>

          <div className="table-container">
            <div className="table-responsive">
              <table className="applications-table">
                <thead>
                  <tr>
                    <th>ФИО</th>
                    <th>Кабинет</th>
                    <th>Телефон</th>
                    <th>Заявка</th>
                    <th>Что сделано</th>
                    <th>Исполнитель</th>
                    <th>Дата подачи</th>
                    <th>Начало</th>
                    <th>Окончание</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.length > 0 ? (
                    applications.map((app) => (
                      <tr key={app.id} className={app.fl ? 'row-completed' : ''}>
                        <td className="cell-name">{app.name}</td>
                        <td>{app.cabinet || '—'}</td>
                        <td>{app.N_tel || '—'}</td>
						
                        <td 
                             className="cell-application" 
                             data-tooltip={app.application}
                             onMouseMove={(e) => {
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

                        <td className="cell-executor">
                          {app.executor ? (
                            <>
                              {app.executor.split('\n').map((name, index, array) => {
                                const parts = name.split(/\s+/);
                                const result = [];
                                for (let i = 0; i < parts.length; i += 2) {
                                  if (i > 0) {
                                    result.push(<br key={`br-${i}`} />);
                                  }
                                  if (i + 1 < parts.length) {
                                    result.push(
                                      <span key={i}>
                                        {parts[i]} {parts[i + 1]}
                                      </span>
                                    );
                                  } else {
                                    result.push(<span key={i}>{parts[i]}</span>);
                                  }
                                }
                                
                                return (
                                  <span key={index} className="executor-name">
                                    {result}
                                    {index < array.length - 1 && <br />}
                                  </span>
                                );
                              })}
                            </>
                          ) : (
                            'Не назначен'
                          )}
                        </td>
                        
                        <td className="cell-date">{formatDate(app.data)}</td>
                        <td className="cell-date">{formatTime(app.start_data)}</td>
                        <td className="cell-date">{formatTime(app.end_data)}</td>
                        <td>{getStatusLabel(app.fl)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="10" className="no-data">
                        <span className="science-icon">🔍</span>
                        {searchTerm 
                          ? `Не найдено заявок по запросу "${searchTerm}"`
                          : 'Нет заявок по данному фильтру'
                        }
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Пагинация */}
          {renderPagination()}
        </>
      )}
    </div>
  );
};

export default Dashboard;