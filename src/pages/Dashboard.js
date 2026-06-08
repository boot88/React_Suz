import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import './Dashboard.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { useAuth } from '../context/AuthContext';

const STATUS_META = {
  new: { label: 'Новая', icon: '📥' },
  accepted: { label: 'Принята', icon: '🤝' },
  in_progress: { label: 'В работе', icon: '🛠️' },
  waiting_employee_confirmation: { label: 'Ждёт сотрудника', icon: '👤' },
  done: { label: 'Выполнено', icon: '✅' },
  reopened: { label: 'Переоткрыта', icon: '↩️' }
};
const WORKFLOW_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'queue', label: 'Новые' },
  { id: 'active', label: 'В работе' },
  { id: 'confirmation', label: 'На подтверждении' },
  { id: 'done', label: 'Выполненные' }
];
const formatDuration = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
};

const Dashboard = () => {
  const { user } = useAuth();
  const [applications, setApplications] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [exportLoading, setExportLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [workflowMessage, setWorkflowMessage] = useState('');
  const [actionBusyId, setActionBusyId] = useState(null);
  const didInitialLoadRef = useRef(false);

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
        'Статус': STATUS_META[app.status]?.label || (app.fl ? 'Выполнено' : 'Новая')
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
      
      if (filter !== 'all') url += `&status=${encodeURIComponent(filter)}`;
      if (dateFilterActive) {
        if (fromDate) url += `&from=${fromDate}`;
        if (toDate) url += `&to=${toDate}`;
      }

      const response = await fetch(`${API_BASE_URL}${url}`);
      const data = await response.json();

      setApplications(data.applications || []);
      setTotalPages(data.totalPages || 1);
      setFilteredStats(data.stats || { total: 0, completed: 0, pending: 0 });
    } catch (error) {
      console.error('Ошибка загрузки:', error);
      // Убираем блокирующий alert при стартовой загрузке,
      // чтобы интерфейс не показывал всплывающее окно подтверждения.
      setApplications([]);
      setFilteredStats({ total: 0, completed: 0, pending: 0 });
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
    fetchApplications();
    didInitialLoadRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInitialLoadRef.current) return undefined;

    const timer = setTimeout(() => {
      fetchApplications();
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, limit, filter, fromDate, toDate, dateFilterActive, searchTerm]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchApplications();
        fetchGeneralStats();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const getStatusLabel = (app) => {
    const status = app.status || (app.fl ? 'done' : 'new');
    const meta = STATUS_META[status] || STATUS_META.new;
    return <span className={`status-badge status-${status}`}><span className="status-icon">{meta.icon}</span>{meta.label}</span>;
  };

  const runWorkflowAction = async (app, action) => {
    const payload = { actor: user?.username || user?.name || 'admin' };
    if (action === 'accept') {
      const executor = window.prompt('Кто подойдёт к сотруднику?', app.executor || user?.name || user?.username || 'Администратор');
      if (!executor) return;
      const eta = window.prompt('Через сколько минут подойдут?', app.eta_minutes || '10');
      const comment = window.prompt('Комментарий сотруднику', app.admin_comment || `К вам подойдут через ${eta || 10} минут`);
      payload.accepted_by = user?.username || 'admin';
      payload.executor = executor;
      payload.eta_minutes = Number(eta) || 10;
      payload.admin_comment = comment || `К вам подойдут через ${Number(eta) || 10} минут`;
    }
    if (action === 'resolve') {
      const process = window.prompt('Что сделано? Это увидит сотрудник.', app.process || 'Проблема устранена');
      if (!process) return;
      payload.process = process;
    }

    setActionBusyId(app.id);
    setWorkflowMessage('');
    try {
      const response = await fetch(`${API_BASE_URL}/applications/${app.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось изменить статус');
      setApplications((prev) => prev.map((item) => (item.id === app.id ? data.application : item)));
      setWorkflowMessage(data.message || 'Статус заявки обновлён');
      fetchGeneralStats();
      fetchApplications();
    } catch (error) {
      setWorkflowMessage(error.message || 'Ошибка изменения статуса');
    } finally {
      setActionBusyId(null);
    }
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

      <div className="workflow-tabs">
        {WORKFLOW_FILTERS.map((item) => (
          <button key={item.id} type="button" className={filter === item.id ? 'active' : ''} onClick={() => setFilterAndResetPage(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {workflowMessage && <div className="workflow-message">{workflowMessage}</div>}

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
                    <th>Таймеры</th>
                    <th>Статус</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.length > 0 ? (
                    applications.map((app) => (
                      <tr key={app.id} className={app.fl ? 'row-completed' : `row-${app.status || 'new'}`}>
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
                        <td className="cell-date"><div>Ожидание: {formatDuration(app.waiting_seconds)}</div><div>Приход: {formatDuration(app.arrival_seconds)}</div><div>Работа: {formatDuration(app.work_seconds)}</div>{app.admin_comment && <small>{app.admin_comment}</small>}</td>
                        <td>{getStatusLabel(app)}</td>
                        <td><div className="workflow-actions">
                          {['new', 'reopened'].includes(app.status || 'new') && <button type="button" disabled={actionBusyId === app.id} onClick={() => runWorkflowAction(app, 'accept')}>Взять</button>}
                          {app.status === 'accepted' && <button type="button" disabled={actionBusyId === app.id} onClick={() => runWorkflowAction(app, 'start-work')}>Начать</button>}
                          {app.status === 'in_progress' && <button type="button" disabled={actionBusyId === app.id} onClick={() => runWorkflowAction(app, 'resolve')}>На подтверждение</button>}
                          {app.employee_login && <a href={`/employee?dialog=${encodeURIComponent(app.employee_login)}&application=${app.id}`}>Чат</a>}
                        </div></td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="12" className="no-data">
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
