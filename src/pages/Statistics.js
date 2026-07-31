import React, { useState, useEffect, useCallback } from 'react';
import {
  Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart,
  Legend
} from 'recharts';
import './Statistics.css';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

const INSTITUTE_COLORS = {
  primary: '#0056b3',
  secondary: '#17a2b8',
  accent: '#28a745',
  warning: '#ffc107',
  light: '#e7f3ff',
  dark: '#343a40',
  gray: '#6c757d',
  lightGray: '#f8f9fa'
};

const EXECUTOR_COLORS = {
  'Повисок Е.В.': INSTITUTE_COLORS.primary,
  'Польников Д.В.': INSTITUTE_COLORS.secondary,
  'Андреев Р.В.': '#FFBB28',
  'Польников Д.В. Повисок Е.В.': '#FF8042',
  'Повисок Е.В. Андреев Р.В.': '#8884D8',
  'Андреев Р.В. Польников Д.В.': '#82CA9D',
  'Повисок Е.В. Польников Д.В. Андреев Р.В.': '#FF6B6B',
  'Другие': '#ADB5BD'
};

const TIME_LINE_COLORS = [
  INSTITUTE_COLORS.primary,
  INSTITUTE_COLORS.secondary,
  '#FFBB28',
  '#FF8042',
  '#8884D8',
  '#82CA9D',
  '#FF6B6B',
  '#ADB5BD'
];

const Statistics = () => {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});
  const [chartData, setChartData] = useState([]);
  const [pieData, setPieData] = useState([]);
  const [timeChartData, setTimeChartData] = useState([]);
  const [timeRange, setTimeRange] = useState('month');
  const [filteredChartData, setFilteredChartData] = useState([]);
  const [allMonths, setAllMonths] = useState([]);
  const [, setDebugInfo] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [zoomMode, setZoomMode] = useState(false);
  
  // Добавляем состояние для управления видимостью линий
  const [visibleLines, setVisibleLines] = useState({
    'Повисок Е.В.': true,
    'Польников Д.В.': true,
    'Андреев Р.В.': true,
    'Польников Д.В. Повисок Е.В.': false,
    'Повисок Е.В. Андреев Р.В.': false,
    'Андреев Р.В. Польников Д.В.': false,
    'Повисок Е.В. Польников Д.В. Андреев Р.В.': false,
    'Другие': false
  });

  
  // Загрузка данных
  useEffect(() => {
    const fetchAllApplications = async () => {
      try {
        setLoading(true);
        setError(null);
        
        console.log('Загрузка ВСЕХ заявок для статистики...');
        
        const response = await authFetch(`${API_BASE_URL}/applications/all`);
        
        if (!response.ok) {
          const fallbackResponse = await authFetch(`${API_BASE_URL}/applications?limit=10000`);
          if (!fallbackResponse.ok) {
            throw new Error(`Ошибка при загрузке данных: ${fallbackResponse.status}`);
          }
          const fallbackData = await fallbackResponse.json();
          setApplications(fallbackData.applications || []);
        } else {
          const data = await response.json();
          setApplications(data.applications || []);
        }
        
      } catch (err) {
        setError(err.message);
        console.error('Ошибка загрузки заявок:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllApplications();
  }, []);

  const parseDateWithTimeZone = useCallback((dateStr) => {
    if (!dateStr) return null;
    
    const date = new Date(dateStr);
    
    if (!isNaN(date.getTime())) {
      return date;
    }
    
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return new Date(dateStr + 'T00:00:00.000Z');
      }
      
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
        return new Date(dateStr.replace(' ', 'T') + '.000Z');
      }
    } catch (error) {
      console.warn('Не удалось распарсить дату:', dateStr, error);
    }
    
    return null;
  }, []);

  const getMonthName = useCallback((monthNumber) => {
    const months = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];
    return months[monthNumber - 1] || monthNumber;
  }, []);

  // Функция для расчета комбинаций исполнителей с отчествами
  const calculateExecutorCombinations = useCallback(() => {
    const combinations = {
      'Повисок Е.В.': 0,
      'Польников Д.В.': 0,
      'Андреев Р.В.': 0,
      'Польников Д.В. Повисок Е.В.': 0,
      'Повисок Е.В. Андреев Р.В.': 0,
      'Андреев Р.В. Польников Д.В.': 0,
      'Повисок Е.В. Польников Д.В. Андреев Р.В.': 0,
      'Другие': 0
    };

    applications.forEach(app => {
      if (app.executor) {
        const executorStr = app.executor.toLowerCase();
        
        // Проверяем наличие фамилий с отчествами
        const hasPovisok = executorStr.includes('повисок');
        const hasPolnikov = executorStr.includes('польников');
        const hasAndreev = executorStr.includes('андреев');
        
        // Считаем количество фамилий
        const count = (hasPovisok ? 1 : 0) + (hasPolnikov ? 1 : 0) + (hasAndreev ? 1 : 0);
        
        // Определяем комбинацию
        if (count === 1) {
          if (hasPovisok) combinations['Повисок Е.В.']++;
          else if (hasPolnikov) combinations['Польников Д.В.']++;
          else if (hasAndreev) combinations['Андреев Р.В.']++;
          else combinations['Другие']++;
        } 
        else if (count === 2) {
          if (hasPovisok && hasPolnikov) combinations['Польников Д.В. Повисок Е.В.']++;
          else if (hasPovisok && hasAndreev) combinations['Повисок Е.В. Андреев Р.В.']++;
          else if (hasAndreev && hasPolnikov) combinations['Андреев Р.В. Польников Д.В.']++;
          else combinations['Другие']++;
        }
        else if (count === 3) {
          combinations['Повисок Е.В. Польников Д.В. Андреев Р.В.']++;
        }
        else {
          combinations['Другие']++;
        }
      } else {
        combinations['Другие']++;
      }
    });

    // Преобразуем в массив для диаграммы
    return Object.entries(combinations)
      .filter(([name, value]) => value > 0)
      .map(([name, value]) => ({
        name,
        value,
        percentage: applications.length > 0 ? ((value / applications.length) * 100).toFixed(1) : '0',
        color: EXECUTOR_COLORS[name] || INSTITUTE_COLORS.gray
      }))
      .sort((a, b) => b.value - a.value);
  }, [applications]);

  // Функция для подготовки данных временного графика
  const calculateTimeChartData = useCallback(() => {
    if (applications.length === 0) return [];

    // Группируем заявки по дням и исполнителям
    const daysMap = new Map();
    
    applications.forEach(app => {
      if (app.start_data) {
        const startDate = parseDateWithTimeZone(app.start_data);
        if (startDate && !isNaN(startDate.getTime())) {
          const dateKey = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
          const hour = startDate.getHours() + startDate.getMinutes() / 60; // Часы с дробной частью
          
          // Определяем комбинацию исполнителей
          let executorCategory = 'Другие';
          if (app.executor) {
            const executorStr = app.executor.toLowerCase();
            const hasPovisok = executorStr.includes('повисок');
            const hasPolnikov = executorStr.includes('польников');
            const hasAndreev = executorStr.includes('андреев');
            
            const count = (hasPovisok ? 1 : 0) + (hasPolnikov ? 1 : 0) + (hasAndreev ? 1 : 0);
            
            if (count === 1) {
              if (hasPovisok) executorCategory = 'Повисок Е.В.';
              else if (hasPolnikov) executorCategory = 'Польников Д.В.';
              else if (hasAndreev) executorCategory = 'Андреев Р.В.';
            } 
            else if (count === 2) {
              if (hasPovisok && hasPolnikov) executorCategory = 'Польников Д.В. Повисок Е.В.';
              else if (hasPovisok && hasAndreev) executorCategory = 'Повисок Е.В. Андреев Р.В.';
              else if (hasAndreev && hasPolnikov) executorCategory = 'Андреев Р.В. Польников Д.В.';
            }
            else if (count === 3) {
              executorCategory = 'Повисок Е.В. Польников Д.В. Андреев Р.В.';
            }
          }

          if (!daysMap.has(dateKey)) {
            const dayData = {
              date: dateKey,
              dateObj: new Date(dateKey),
              'Повисок Е.В.': [],
              'Польников Д.В.': [],
              'Андреев Р.В.': [],
              'Польников Д.В. Повисок Е.В.': [],
              'Повисок Е.В. Андреев Р.В.': [],
              'Андреев Р.В. Польников Д.В.': [],
              'Повисок Е.В. Польников Д.В. Андреев Р.В.': [],
              'Другие': []
            };
            daysMap.set(dateKey, dayData);
          }
          
          const dayData = daysMap.get(dateKey);
          if (!dayData[executorCategory]) {
            dayData[executorCategory] = [];
          }
          dayData[executorCategory].push({
            hour: hour,
            application: app.application,
            name: app.name,
            executor: app.executor
          });
        }
      }
    });

    // Преобразуем в массив и сортируем по дате
    const daysArray = Array.from(daysMap.values())
      .sort((a, b) => a.dateObj - b.dateObj);

    // Для каждого дня вычисляем средний час для каждой категории
    return daysArray.map(day => {
      const result = {
        date: day.date,
        dateDisplay: new Date(day.date).toLocaleDateString('ru-RU', { 
          day: 'numeric', 
          month: 'numeric' 
        }),
        dateObj: day.dateObj
      };

      // Вычисляем среднее время для каждой категории (только если есть данные)
      const categories = [
        'Повисок Е.В.',
        'Польников Д.В.',
        'Андреев Р.В.',
        'Польников Д.В. Повисок Е.В.',
        'Повисок Е.В. Андреев Р.В.',
        'Андреев Р.В. Польников Д.В.',
        'Повисок Е.В. Польников Д.В. Андреев Р.В.',
        'Другие'
      ];

      categories.forEach(category => {
        if (day[category] && day[category].length > 0) {
          // Средний час выполнения заявок этой категории в этот день
          const avgHour = day[category].reduce((sum, item) => sum + item.hour, 0) / day[category].length;
          result[`${category}_hour`] = parseFloat(avgHour.toFixed(2));
          
          // Сохраняем все заявки этой категории для тултипа
          result[`${category}_applications`] = day[category];
        } else {
          result[`${category}_hour`] = null;
          result[`${category}_applications`] = [];
        }
      });

      return result;
    });
  }, [applications, parseDateWithTimeZone]);

  // Расчет основной статистики
  const calculateStatistics = useCallback(() => {
    if (applications.length === 0) {
      setDebugInfo('Нет данных для анализа');
      return;
    }

    let debugText = `=== АНАЛИЗ ДАННЫХ ===\n`;
    debugText += `Всего заявок: ${applications.length}\n\n`;

    // Проверяем диапазон дат
    const allDates = applications
      .map(app => ({ data: app.data, parsed: parseDateWithTimeZone(app.data) }))
      .filter(item => item.parsed && !isNaN(item.parsed.getTime()))
      .sort((a, b) => a.parsed - b.parsed);

    if (allDates.length === 0) {
      setDebugInfo('Нет корректных дат для анализа');
      return;
    }

    const firstDate = allDates[0];
    const lastDate = allDates[allDates.length - 1];
    
    debugText += `ДИАПАЗОН ДАТ В БАЗЕ:\n`;
    debugText += `Первая заявка: ${firstDate.data} -> ${firstDate.parsed.toLocaleDateString('ru-RU')}\n`;
    debugText += `Последняя заявка: ${lastDate.data} -> ${lastDate.parsed.toLocaleDateString('ru-RU')}\n\n`;

    // Собираем статистику по дням и месяцам
    const dailyStats = {};
    const monthStats = {};
    let maxDailyApplications = 0;

    applications.forEach(app => {
      const parsedDate = parseDateWithTimeZone(app.data);
      if (parsedDate && !isNaN(parsedDate.getTime())) {
        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const day = String(parsedDate.getDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${day}`;
        const monthKey = `${month}.${year}`;
        
        dailyStats[dateKey] = (dailyStats[dateKey] || 0) + 1;
        monthStats[monthKey] = (monthStats[monthKey] || 0) + 1;
        
        if (dailyStats[dateKey] > maxDailyApplications) {
          maxDailyApplications = dailyStats[dateKey];
        }
      }
    });

    // Создаем данные для графика
    const dailyChartData = [];
    const currentDate = new Date(firstDate.parsed);
    const endDate = new Date(lastDate.parsed);
    
    while (currentDate <= endDate) {
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      const monthYear = `${month}.${year}`;
      
      dailyChartData.push({
        date: dateKey,
        applications: dailyStats[dateKey] || 0,
        dateObj: new Date(currentDate),
        monthYear: monthYear
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Статистика по месяцам
    const monthsArray = Object.entries(monthStats)
      .map(([monthYear, count]) => {
        const [month, year] = monthYear.split('.').map(Number);
        return { 
          month, 
          year, 
          count, 
          monthYear,
          monthName: getMonthName(month)
        };
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
      });

    debugText += `РАСПРЕДЕЛЕНИЕ ПО МЕСЯЦАМ:\n`;
    monthsArray.forEach(({ monthName, year, count }) => {
      debugText += `  ${monthName} ${year}: ${count} заявок\n`;
    });

    // Круговая диаграмма по комбинациям исполнителей
    const pieChartData = calculateExecutorCombinations();

    // Временной график
    const timeChartData = calculateTimeChartData();

    // Общая статистика
    const totalApplications = applications.length;
    const completedApplications = applications.filter(app => app.fl === true).length;
    const pendingApplications = applications.filter(app => !app.fl).length;

    const departmentStats = {};
    applications.forEach(app => {
      const department = app.cabinet || 'Не указан';
      departmentStats[department] = (departmentStats[department] || 0) + 1;
    });

    setStats({
      totalApplications,
      completedApplications,
      pendingApplications,
      completionRate: totalApplications > 0 ? ((completedApplications / totalApplications) * 100).toFixed(2) : 0,
      departmentStats,
      verticalScaleMax: maxDailyApplications,
      firstDate: firstDate.parsed,
      lastDate: lastDate.parsed
    });

    setChartData(dailyChartData);
    setPieData(pieChartData);
    setTimeChartData(timeChartData);
    setAllMonths(monthsArray);
    setDebugInfo(debugText);
    
    console.log('Статистика рассчитана:');
    console.log('- Всего заявок:', totalApplications);
    console.log('- Диапазон дат:', firstDate.data, 'до', lastDate.data);
    console.log('- Данные временного графика:', timeChartData.length, 'дней');
  }, [applications, parseDateWithTimeZone, getMonthName, calculateExecutorCombinations, calculateTimeChartData]);

  // Фильтрация данных
  const filterChartDataByRange = useCallback(() => {
    if (chartData.length === 0) return;

    let filteredData = [...chartData];

    if (zoomMode && selectedMonth) {
      filteredData = chartData.filter(item => item.monthYear === selectedMonth);
    } else {
      const now = new Date();
      switch (timeRange) {
        case 'week':
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          filteredData = chartData.filter(item => item.dateObj >= weekAgo);
          break;
        case 'month':
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          filteredData = chartData.filter(item => item.dateObj >= monthAgo);
          break;
        case 'all':
        default:
          filteredData = chartData;
          break;
      }
    }

    setFilteredChartData(filteredData);
  }, [chartData, timeRange, zoomMode, selectedMonth]);

  // Функция для обработки изменения видимости линий
  const handleLineVisibilityChange = useCallback((category) => {
    setVisibleLines(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  }, []);

  // Функция для выбора всех линий
  const handleSelectAllLines = useCallback(() => {
    setVisibleLines({
      'Повисок Е.В.': true,
      'Польников Д.В.': true,
      'Андреев Р.В.': true,
      'Польников Д.В. Повисок Е.В.': true,
      'Повисок Е.В. Андреев Р.В.': true,
      'Андреев Р.В. Польников Д.В.': true,
      'Повисок Е.В. Польников Д.В. Андреев Р.В.': true,
      'Другие': true
    });
  }, []);

  // Функция для сброса выбора линий
  const handleResetLines = useCallback(() => {
    setVisibleLines({
      'Повисок Е.В.': true,
      'Польников Д.В.': true,
      'Андреев Р.В.': true,
      'Польников Д.В. Повисок Е.В.': false,
      'Повисок Е.В. Андреев Р.В.': false,
      'Андреев Р.В. Польников Д.В.': false,
      'Повисок Е.В. Польников Д.В. Андреев Р.В.': false,
      'Другие': false
    });
  }, []);

  // Эффекты
  useEffect(() => {
    if (applications.length > 0) {
      calculateStatistics();
    }
  }, [applications, calculateStatistics]);

  useEffect(() => {
    if (chartData.length > 0) {
      filterChartDataByRange();
    }
  }, [chartData, timeRange, zoomMode, selectedMonth, filterChartDataByRange]);

  // Масштабирование
  const zoomToMonth = (monthYear) => {
    setZoomMode(true);
    setSelectedMonth(monthYear);
  };

  const resetZoom = () => {
    setZoomMode(false);
    setSelectedMonth(null);
  };

  // Кастомный тултип для временного графика
  const TimeChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const executorCategories = [
        'Повисок Е.В.',
        'Польников Д.В.',
        'Андреев Р.В.',
        'Польников Д.В. Повисок Е.В.',
        'Повисок Е.В. Андреев Р.В.',
        'Андреев Р.В. Польников Д.В.',
        'Повисок Е.В. Польников Д.В. Андреев Р.В.',
        'Другие'
      ];

      return (
        <div className="custom-tooltip" style={{
          backgroundColor: 'white',
          padding: '15px',
          border: '1px solid #ccc',
          borderRadius: '6px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          maxWidth: '400px'
        }}>
          <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', color: '#333' }}>
            {new Date(data.date).toLocaleDateString('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            })}
          </p>
          
          {executorCategories.map(category => {
            const hourKey = `${category}_hour`;
            const appsKey = `${category}_applications`;
            
            if (data[hourKey] !== null && data[hourKey] !== undefined) {
              const hour = Math.floor(data[hourKey]);
              const minutes = Math.round((data[hourKey] - hour) * 60);
              const timeStr = `${hour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
              
              return (
                <div key={category} style={{ marginBottom: '10px' }}>
                  <p style={{ margin: '0 0 5px 0', fontWeight: 'bold', color: EXECUTOR_COLORS[category] }}>
                    {category}: {timeStr}
                  </p>
                  {data[appsKey] && data[appsKey].length > 0 && (
                    <div style={{ fontSize: '12px', marginLeft: '10px' }}>
                      <p style={{ margin: '2px 0', fontWeight: 'bold' }}>Заявки:</p>
                      {data[appsKey].slice(0, 3).map((app, idx) => (
                        <p key={idx} style={{ margin: '2px 0', color: '#666' }}>
                          • {app.application.substring(0, 50)}...
                        </p>
                      ))}
                      {data[appsKey].length > 3 && (
                        <p style={{ margin: '2px 0', color: '#999', fontStyle: 'italic' }}>
                          ...и еще {data[appsKey].length - 3} заявок
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="statistics-container">
        <div style={{ 
          textAlign: 'center', 
          padding: '80px 20px',
          backgroundColor: 'white',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <div style={{
            display: 'inline-block',
            width: '50px',
            height: '50px',
            border: `5px solid ${INSTITUTE_COLORS.light}`,
            borderTopColor: INSTITUTE_COLORS.primary,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: '20px'
          }}></div>
          <h3 style={{ color: INSTITUTE_COLORS.dark, marginBottom: '10px' }}>Загрузка статистики</h3>
          <p style={{ color: INSTITUTE_COLORS.gray }}>Подключаемся к базе данных...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="statistics-container">
        <div style={{ 
          backgroundColor: '#f8d7da', 
          padding: '30px', 
          borderRadius: '10px', 
          marginBottom: '20px',
          color: '#721c24',
          border: '1px solid #f5c6cb',
          textAlign: 'center'
        }}>
          <h3 style={{ marginBottom: '15px' }}>Ошибка загрузки данных</h3>
          <p style={{ marginBottom: '20px' }}>{error}</p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 25px',
              backgroundColor: INSTITUTE_COLORS.primary,
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '16px',
              transition: 'background-color 0.3s'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = INSTITUTE_COLORS.secondary}
            onMouseOut={(e) => e.target.style.backgroundColor = INSTITUTE_COLORS.primary}
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="statistics-container">
      {/* Заголовок */}
      <div style={{ 
        marginBottom: '30px',
        paddingBottom: '20px',
        borderBottom: `2px solid ${INSTITUTE_COLORS.light}`
      }}>
        <h1 style={{ 
          color: INSTITUTE_COLORS.dark, 
          marginBottom: '10px',
          fontSize: '28px',
          fontWeight: '600'
        }}>
          Статистика заявок ИТС
        </h1>
        <p style={{ 
          color: INSTITUTE_COLORS.gray,
          fontSize: '16px',
          margin: 0
        }}>
          Институт органической химии - Аналитическая панель
        </p>
      </div>

      {/* Блок 1: Ключевые метрики */}
      <div style={{ 
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '20px',
        marginBottom: '30px'
      }}>
        {/* Всего заявок */}
        <div style={{ 
          backgroundColor: 'white',
          padding: '25px',
          borderRadius: '10px',
          boxShadow: '0 3px 15px rgba(0,0,0,0.08)',
          borderTop: `4px solid ${INSTITUTE_COLORS.primary}`,
          transition: 'transform 0.3s'
        }} onMouseOver={(e) => e.target.style.transform = 'translateY(-5px)'}
           onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            marginBottom: '15px'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              backgroundColor: INSTITUTE_COLORS.light,
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '15px'
            }}>
              <span style={{ 
                fontSize: '24px', 
                color: INSTITUTE_COLORS.primary,
                fontWeight: 'bold'
              }}>{stats.totalApplications || 0}</span>
            </div>
            <div>
              <h3 style={{ 
                margin: '0 0 5px 0', 
                color: INSTITUTE_COLORS.dark,
                fontSize: '16px'
              }}>Всего заявок</h3>
              <p style={{ 
                margin: 0, 
                color: INSTITUTE_COLORS.gray,
                fontSize: '14px'
              }}>За весь период</p>
            </div>
          </div>
        </div>

        {/* Выполнено */}
        <div style={{ 
          backgroundColor: 'white',
          padding: '25px',
          borderRadius: '10px',
          boxShadow: '0 3px 15px rgba(0,0,0,0.08)',
          borderTop: `4px solid ${INSTITUTE_COLORS.accent}`,
          transition: 'transform 0.3s'
        }} onMouseOver={(e) => e.target.style.transform = 'translateY(-5px)'}
           onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            marginBottom: '15px'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              backgroundColor: '#e7f6ea',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '15px'
            }}>
              <span style={{ 
                fontSize: '24px', 
                color: INSTITUTE_COLORS.accent,
                fontWeight: 'bold'
              }}>{stats.completedApplications || 0}</span>
            </div>
            <div>
              <h3 style={{ 
                margin: '0 0 5px 0', 
                color: INSTITUTE_COLORS.dark,
                fontSize: '16px'
              }}>Выполнено</h3>
              <p style={{ 
                margin: 0, 
                color: INSTITUTE_COLORS.gray,
                fontSize: '14px'
              }}>Успешно закрыто</p>
            </div>
          </div>
          <div style={{
            height: '6px',
            backgroundColor: INSTITUTE_COLORS.light,
            borderRadius: '3px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${stats.completionRate || 0}%`,
              height: '100%',
              backgroundColor: INSTITUTE_COLORS.accent,
              borderRadius: '3px'
            }}></div>
          </div>
          <p style={{ 
            margin: '8px 0 0 0',
            fontSize: '14px',
            color: INSTITUTE_COLORS.gray
          }}>
            <strong style={{ color: INSTITUTE_COLORS.accent }}>{stats.completionRate || 0}%</strong> выполнения
          </p>
        </div>

        {/* В работе */}
        <div style={{ 
          backgroundColor: 'white',
          padding: '25px',
          borderRadius: '10px',
          boxShadow: '0 3px 15px rgba(0,0,0,0.08)',
          borderTop: `4px solid ${INSTITUTE_COLORS.warning}`,
          transition: 'transform 0.3s'
        }} onMouseOver={(e) => e.target.style.transform = 'translateY(-5px)'}
           onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            marginBottom: '15px'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              backgroundColor: '#fff8e1',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '15px'
            }}>
              <span style={{ 
                fontSize: '24px', 
                color: INSTITUTE_COLORS.warning,
                fontWeight: 'bold'
              }}>{stats.pendingApplications || 0}</span>
            </div>
            <div>
              <h3 style={{ 
                margin: '0 0 5px 0', 
                color: INSTITUTE_COLORS.dark,
                fontSize: '16px'
              }}>В работе</h3>
              <p style={{ 
                margin: 0, 
                color: INSTITUTE_COLORS.gray,
                fontSize: '14px'
              }}>Текущие задачи</p>
            </div>
          </div>
        </div>

        {/* Период */}
        <div style={{ 
          backgroundColor: 'white',
          padding: '25px',
          borderRadius: '10px',
          boxShadow: '0 3px 15px rgba(0,0,0,0.08)',
          borderTop: `4px solid ${INSTITUTE_COLORS.secondary}`,
          transition: 'transform 0.3s'
        }} onMouseOver={(e) => e.target.style.transform = 'translateY(-5px)'}
           onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            marginBottom: '15px'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              backgroundColor: '#e7f3ff',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '15px'
            }}>
              <span style={{ 
                fontSize: '20px', 
                color: INSTITUTE_COLORS.secondary,
                fontWeight: 'bold',
                textAlign: 'center'
              }}>{allMonths.length}</span>
            </div>
            <div>
              <h3 style={{ 
                margin: '0 0 5px 0', 
                color: INSTITUTE_COLORS.dark,
                fontSize: '16px'
              }}>Период</h3>
              <p style={{ 
                margin: 0, 
                color: INSTITUTE_COLORS.gray,
                fontSize: '14px'
              }}>
                {stats.firstDate && stats.lastDate ? (
                  <>
                    {stats.firstDate.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })} -{' '}
                    {stats.lastDate.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })}
                  </>
                ) : 'Нет данных'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Блок 2: Основной график - Динамика заявок */}
      <div style={{ 
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '10px',
        boxShadow: '0 3px 15px rgba(0,0,0,0.08)',
        marginBottom: '30px'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '25px',
          flexWrap: 'wrap',
          gap: '15px'
        }}>
          <div>
            <h2 style={{ 
              margin: '0 0 5px 0', 
              color: INSTITUTE_COLORS.dark,
              fontSize: '20px',
              fontWeight: '600'
            }}>
              Динамика заявок
            </h2>
            <p style={{ 
              margin: 0, 
              color: INSTITUTE_COLORS.gray,
              fontSize: '14px'
            }}>
              Количество заявок по дням
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {/* Кнопки масштабирования */}
            <div style={{ 
              display: 'flex', 
              backgroundColor: INSTITUTE_COLORS.light,
              borderRadius: '8px',
              padding: '4px'
            }}>
              {['week', 'month', 'all'].map((range) => (
                <button 
                  key={range}
                  onClick={() => {
                    resetZoom();
                    setTimeRange(range);
                  }}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: !zoomMode && timeRange === range ? INSTITUTE_COLORS.primary : 'transparent',
                    color: !zoomMode && timeRange === range ? 'white' : INSTITUTE_COLORS.dark,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: !zoomMode && timeRange === range ? '600' : '400',
                    fontSize: '14px',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                  disabled={zoomMode}
                >
                  {range === 'week' ? 'Неделя' : 
                   range === 'month' ? 'Месяц' : 
                   'Весь период'}
                </button>
              ))}
            </div>
            
            {/* Кнопка сброса масштаба */}
            {zoomMode && (
              <button 
                onClick={resetZoom}
                style={{
                  padding: '8px 16px',
                  backgroundColor: INSTITUTE_COLORS.gray,
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <span>✕</span>
                Сбросить
              </button>
            )}
          </div>
        </div>

        {/* Месяцы для быстрого выбора */}
        {allMonths.length > 0 && (
          <div style={{ 
            marginBottom: '20px',
            padding: '15px',
            backgroundColor: INSTITUTE_COLORS.light,
            borderRadius: '8px'
          }}>
            <p style={{ 
              margin: '0 0 10px 0', 
              fontSize: '14px', 
              color: INSTITUTE_COLORS.dark,
              fontWeight: '500'
            }}>
              Быстрый выбор месяца:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {allMonths.map(({ month, year, count, monthYear, monthName }, index) => {
                const isSelected = zoomMode && selectedMonth === monthYear;
                return (
                  <button 
                    key={index} 
                    onClick={() => zoomToMonth(monthYear)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: isSelected ? INSTITUTE_COLORS.primary : 'white',
                      color: isSelected ? 'white' : INSTITUTE_COLORS.dark,
                      border: `1px solid ${isSelected ? INSTITUTE_COLORS.primary : '#dee2e6'}`,
                      borderRadius: '20px',
                      fontSize: '13px',
                      fontWeight: isSelected ? '600' : '400',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.2s'
                    }}
                    title={`${monthName} ${year}: ${count} заявок`}
                  >
                    {monthName.slice(0, 3)} {year.toString().slice(2)}
                    <span style={{ 
                      fontSize: '11px', 
                      backgroundColor: isSelected ? 'rgba(255,255,255,0.3)' : INSTITUTE_COLORS.light,
                      padding: '2px 6px', 
                      borderRadius: '10px' 
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* График */}
        {chartData.length > 0 && (
          <div style={{ height: '400px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart 
                data={filteredChartData}
                margin={{ top: 10, right: 30, left: 20, bottom: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    try {
                      const date = new Date(value);
                      if (isNaN(date.getTime())) return value;
                      
                      const day = date.getDate();
                      const month = date.getMonth() + 1;
                      
                      if (zoomMode || filteredChartData.length <= 60) {
                        return `${day}`;
                      } else {
                        if (day === 1 || filteredChartData.length <= 20) {
                          return `${day}.${month}`;
                        }
                        return day % 5 === 0 ? `${day}` : '';
                      }
                    } catch (error) {
                      return value;
                    }
                  }}
                  angle={-45}
                  textAnchor="end"
                  height={50}
                  interval={zoomMode || filteredChartData.length <= 60 ? 0 : 'preserveEnd'}
                  tick={{ fontSize: 12 }}
                  stroke={INSTITUTE_COLORS.gray}
                />
                <YAxis 
                  domain={[0, stats.verticalScaleMax || 'auto']}
                  allowDecimals={false}
                  stroke={INSTITUTE_COLORS.gray}
                />
                <Tooltip 
                  labelFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString('ru-RU', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    });
                  }}
                  formatter={(value) => [`${value} заявок`, 'Количество']}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: `1px solid ${INSTITUTE_COLORS.light}`,
                    borderRadius: '8px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                  }}
                />
                <Bar 
                  dataKey="applications" 
                  name="Заявок за день" 
                  fill={INSTITUTE_COLORS.primary} 
                  barSize={Math.max(10, Math.min(30, 500 / filteredChartData.length))}
                  radius={[4, 4, 0, 0]}
                  opacity={0.8}
                />
                <Line 
                  type="monotone" 
                  dataKey="applications" 
                  name="Тренд" 
                  stroke={INSTITUTE_COLORS.secondary} 
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, fill: INSTITUTE_COLORS.secondary }}
                  connectNulls={true}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Блок 3: Распределение по исполнителям */}
      {pieData.length > 0 && (
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '30px',
          marginBottom: '30px',
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '10px',
          boxShadow: '0 3px 15px rgba(0,0,0,0.08)'
        }}>
          {/* Левая часть: Круговая диаграмма */}
          <div>
            <h2 style={{ 
              margin: '0 0 25px 0', 
              color: INSTITUTE_COLORS.dark,
              fontSize: '20px',
              fontWeight: '600'
            }}>
              Распределение по исполнителям
            </h2>
            
            <div style={{ height: '350px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percentage }) => `${percentage}%`}
                    outerRadius={130}
                    innerRadius={60}
                    fill="#8884d8"
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {pieData.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.color}
                        stroke="white"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value, name, props) => [
                      `${value} заявок (${props.payload.percentage}%)`,
                      props.payload.name
                    ]}
                    contentStyle={{
                      backgroundColor: 'white',
                      border: `1px solid ${INSTITUTE_COLORS.light}`,
                      borderRadius: '8px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Правая часть: Детальная статистика */}
          <div>
            <h3 style={{ 
              margin: '0 0 20px 0', 
              color: INSTITUTE_COLORS.dark,
              fontSize: '18px',
              fontWeight: '600'
            }}>
              Статистика по исполнителям
            </h3>
            
            <div style={{ 
              maxHeight: '300px', 
              overflowY: 'auto',
              marginBottom: '20px',
              border: `1px solid ${INSTITUTE_COLORS.light}`,
              borderRadius: '8px'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ 
                    backgroundColor: INSTITUTE_COLORS.light,
                    position: 'sticky',
                    top: 0,
                    zIndex: 1
                  }}>
                    <th style={{ 
                      padding: '12px 15px', 
                      textAlign: 'left', 
                      borderBottom: `2px solid ${INSTITUTE_COLORS.light}`,
                      color: INSTITUTE_COLORS.dark,
                      fontSize: '14px',
                      fontWeight: '600'
                    }}>Исполнитель</th>
                    <th style={{ 
                      padding: '12px 15px', 
                      textAlign: 'right', 
                      borderBottom: `2px solid ${INSTITUTE_COLORS.light}`,
                      color: INSTITUTE_COLORS.dark,
                      fontSize: '14px',
                      fontWeight: '600'
                    }}>Заявок</th>
                    <th style={{ 
                      padding: '12px 15px', 
                      textAlign: 'right', 
                      borderBottom: `2px solid ${INSTITUTE_COLORS.light}`,
                      color: INSTITUTE_COLORS.dark,
                      fontSize: '14px',
                      fontWeight: '600'
                    }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {pieData.map((item, index) => (
                    <tr 
                      key={index} 
                      style={{ 
                        borderBottom: `1px solid ${INSTITUTE_COLORS.light}`,
                        backgroundColor: index % 2 === 0 ? 'white' : INSTITUTE_COLORS.lightGray
                      }}
                    >
                      <td style={{ padding: '12px 15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <div style={{
                            width: '12px',
                            height: '12px',
                            backgroundColor: item.color,
                            borderRadius: '2px',
                            marginRight: '12px'
                          }} />
                          <span style={{ 
                            fontSize: '14px',
                            color: INSTITUTE_COLORS.dark
                          }}>{item.name}</span>
                        </div>
                      </td>
                      <td style={{ 
                        padding: '12px 15px', 
                        textAlign: 'right', 
                        fontWeight: '600', 
                        color: INSTITUTE_COLORS.primary,
                        fontSize: '14px'
                      }}>
                        {item.value}
                      </td>
                      <td style={{ 
                        padding: '12px 15px', 
                        textAlign: 'right', 
                        color: INSTITUTE_COLORS.accent,
                        fontSize: '14px'
                      }}>
                        {item.percentage}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ 
                    backgroundColor: INSTITUTE_COLORS.light,
                    fontWeight: '600'
                  }}>
                    <td style={{ 
                      padding: '12px 15px', 
                      borderTop: `2px solid ${INSTITUTE_COLORS.light}`,
                      color: INSTITUTE_COLORS.dark
                    }}>Всего:</td>
                    <td style={{ 
                      padding: '12px 15px', 
                      textAlign: 'right', 
                      borderTop: `2px solid ${INSTITUTE_COLORS.light}`,
                      color: INSTITUTE_COLORS.primary
                    }}>
                      {applications.length}
                    </td>
                    <td style={{ 
                      padding: '12px 15px', 
                      textAlign: 'right', 
                      borderTop: `2px solid ${INSTITUTE_COLORS.light}`,
                      color: INSTITUTE_COLORS.accent
                    }}>
                      100%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Легенда */}
            <div style={{ 
              padding: '15px',
              backgroundColor: INSTITUTE_COLORS.light,
              borderRadius: '8px',
              fontSize: '13px',
              color: INSTITUTE_COLORS.dark
            }}>
              <p style={{ margin: '0 0 10px 0', fontWeight: '600' }}>
                Пояснение к категориям:
              </p>
              <ul style={{ 
                margin: 0, 
                paddingLeft: '20px',
                lineHeight: '1.6'
              }}>
                <li><strong>Одиночные категории</strong> (синий, бирюзовый, желтый) - заявки с одним исполнителем</li>
                <li><strong>Двойные категории</strong> (оранжевый, фиолетовый, зеленый) - заявки с двумя исполнителями</li>
                <li><strong>Тройная категория</strong> (красный) - заявки с тремя исполнителями</li>
                <li><strong>Другие</strong> (серый) - заявки без указанных исполнителей</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Блок 4: Время выполнения */}
      {timeChartData.length > 0 && (
        <div style={{ 
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '10px',
          boxShadow: '0 3px 15px rgba(0,0,0,0.08)',
          marginBottom: '30px'
        }}>
          <h2 style={{ 
            margin: '0 0 5px 0', 
            color: INSTITUTE_COLORS.dark,
            fontSize: '20px',
            fontWeight: '600'
          }}>
            Время выполнения заявок
          </h2>
          <p style={{ 
            margin: '0 0 25px 0', 
            color: INSTITUTE_COLORS.gray,
            fontSize: '14px'
          }}>
            Среднее время начала работы над заявками по комбинациям исполнителей
          </p>

          {/* Панель управления видимостью линий */}
          <div style={{ 
            backgroundColor: INSTITUTE_COLORS.light, 
            padding: '20px', 
            borderRadius: '8px', 
            marginBottom: '25px',
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '15px',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <h4 style={{ 
                margin: 0, 
                color: INSTITUTE_COLORS.dark,
                fontSize: '16px',
                fontWeight: '600'
              }}>
                Управление отображением линий:
              </h4>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button 
                  onClick={handleSelectAllLines}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: INSTITUTE_COLORS.accent,
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>✓</span>
                  Показать все
                </button>
                <button 
                  onClick={handleResetLines}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: INSTITUTE_COLORS.gray,
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>↺</span>
                  Только основные
                </button>
              </div>
            </div>
            
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
              gap: '10px',
              maxHeight: '120px',
              overflowY: 'auto',
              padding: '5px'
            }}>
              {Object.entries(visibleLines).map(([category, isVisible]) => (
                <div 
                  key={category} 
                  onClick={() => handleLineVisibilityChange(category)}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '10px',
                    backgroundColor: isVisible ? 'white' : 'transparent',
                    borderRadius: '6px',
                    border: `1px solid ${isVisible ? EXECUTOR_COLORS[category] : '#e9ecef'}`,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <input
                    type="checkbox"
                    id={`line-${category}`}
                    checked={isVisible}
                    onChange={() => handleLineVisibilityChange(category)}
                    style={{
                      marginRight: '12px',
                      cursor: 'pointer',
                      width: '16px',
                      height: '16px'
                    }}
                  />
                  <label 
                    htmlFor={`line-${category}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: INSTITUTE_COLORS.dark,
                      flex: 1
                    }}
                  >
                    <div style={{
                      width: '14px',
                      height: '14px',
                      backgroundColor: EXECUTOR_COLORS[category] || INSTITUTE_COLORS.gray,
                      borderRadius: '3px',
                      marginRight: '10px'
                    }} />
                    {category}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* График времени выполнения */}
          <div style={{ height: '500px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart 
                data={timeChartData}
                margin={{ top: 10, right: 30, left: 50, bottom: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis 
                  dataKey="dateDisplay" 
                  angle={-45}
                  textAnchor="end"
                  height={50}
                  tick={{ fontSize: 12 }}
                  stroke={INSTITUTE_COLORS.gray}
                />
                <YAxis 
                  domain={[8, 19]} // С 8 утра до 7 вечера
                  tickCount={12}
                  stroke={INSTITUTE_COLORS.gray}
                  tickFormatter={(value) => {
                    if (value >= 0 && value < 24) {
                      return `${Math.floor(value)}:00`;
                    }
                    return value;
                  }}
                  label={{ 
                    value: 'Время суток', 
                    angle: -90, 
                    position: 'insideLeft',
                    offset: -35,
                    style: { textAnchor: 'middle', fill: INSTITUTE_COLORS.dark }
                  }}
                />
                <Tooltip content={<TimeChartTooltip />} />
                <Legend 
                  verticalAlign="top"
                  height={36}
                  iconSize={12}
                  iconType="circle"
                />
                
                {/* Линии для каждой категории исполнителей */}
                {[
                  { key: 'Повисок Е.В._hour', name: 'Повисок Е.В.', color: TIME_LINE_COLORS[0], category: 'Повисок Е.В.' },
                  { key: 'Польников Д.В._hour', name: 'Польников Д.В.', color: TIME_LINE_COLORS[1], category: 'Польников Д.В.' },
                  { key: 'Андреев Р.В._hour', name: 'Андреев Р.В.', color: TIME_LINE_COLORS[2], category: 'Андреев Р.В.' },
                  { key: 'Польников Д.В. Повисок Е.В._hour', name: 'Польников Д.В. Повисок Е.В.', color: TIME_LINE_COLORS[3], category: 'Польников Д.В. Повисок Е.В.' },
                  { key: 'Повисок Е.В. Андреев Р.В._hour', name: 'Повисок Е.В. Андреев Р.В.', color: TIME_LINE_COLORS[4], category: 'Повисок Е.В. Андреев Р.В.' },
                  { key: 'Андреев Р.В. Польников Д.В._hour', name: 'Андреев Р.В. Польников Д.В.', color: TIME_LINE_COLORS[5], category: 'Андреев Р.В. Польников Д.В.' },
                  { key: 'Повисок Е.В. Польников Д.В. Андреев Р.В._hour', name: 'Повисок Е.В. Польников Д.В. Андреев Р.В.', color: TIME_LINE_COLORS[6], category: 'Повисок Е.В. Польников Д.В. Андреев Р.В.' },
                  { key: 'Другие_hour', name: 'Другие', color: TIME_LINE_COLORS[7], category: 'Другие' }
                ]
                .filter(line => visibleLines[line.category])
                .map((line, index) => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    name={line.name}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 8, strokeWidth: 2 }}
                    connectNulls={true}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Пояснение к графику */}
          <div style={{ 
            marginTop: '25px', 
            padding: '20px', 
            backgroundColor: INSTITUTE_COLORS.light, 
            borderRadius: '8px',
          }}>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
              <div style={{
                width: '24px',
                height: '24px',
                backgroundColor: INSTITUTE_COLORS.primary,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <span style={{ color: 'white', fontSize: '14px' }}>i</span>
              </div>
              <div>
                <h5 style={{ 
                  margin: '0 0 10px 0', 
                  color: INSTITUTE_COLORS.dark,
                  fontSize: '15px',
                  fontWeight: '600'
                }}>
                  Как читать этот график:
                </h5>
                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '15px'
                }}>
                  <div>
                    <p style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.dark,
                      fontWeight: '500'
                    }}>
                      📈 <strong>Ось Y</strong>
                    </p>
                    <p style={{ 
                      margin: 0, 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.gray,
                      lineHeight: '1.5'
                    }}>
                      Время суток с 8:00 до 19:00
                    </p>
                  </div>
                  <div>
                    <p style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.dark,
                      fontWeight: '500'
                    }}>
                      📅 <strong>Ось X</strong>
                    </p>
                    <p style={{ 
                      margin: 0, 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.gray,
                      lineHeight: '1.5'
                    }}>
                      Дни в выбранном периоде
                    </p>
                  </div>
                  <div>
                    <p style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.dark,
                      fontWeight: '500'
                    }}>
                      🎯 <strong>Точки</strong>
                    </p>
                    <p style={{ 
                      margin: 0, 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.gray,
                      lineHeight: '1.5'
                    }}>
                      Среднее время начала работы
                    </p>
                  </div>
                  <div>
                    <p style={{ 
                      margin: '0 0 8px 0', 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.dark,
                      fontWeight: '500'
                    }}>
                      🔍 <strong>Интерактивность</strong>
                    </p>
                    <p style={{ 
                      margin: 0, 
                      fontSize: '13px', 
                      color: INSTITUTE_COLORS.gray,
                      lineHeight: '1.5'
                    }}>
                      Наведите на точку для деталей
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Блок 5: Топ кабинетов */}
      {stats.departmentStats && Object.keys(stats.departmentStats).length > 0 && (
        <div style={{ 
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '10px',
          boxShadow: '0 3px 15px rgba(0,0,0,0.08)'
        }}>
          <h2 style={{ 
            margin: '0 0 25px 0', 
            color: INSTITUTE_COLORS.dark,
            fontSize: '20px',
            fontWeight: '600'
          }}>
            Активность по кабинетам
          </h2>
          
          <div style={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '25px'
          }}>
            <div>
              <h3 style={{ 
                margin: '0 0 15px 0', 
                color: INSTITUTE_COLORS.dark,
                fontSize: '18px',
                fontWeight: '600'
              }}>
                Топ-10 кабинетов
              </h3>
              <div style={{ 
                maxHeight: '350px', 
                overflowY: 'auto',
                border: `1px solid ${INSTITUTE_COLORS.light}`,
                borderRadius: '8px'
              }}>
                {Object.entries(stats.departmentStats)
                  .sort(([,a], [,b]) => b - a)
                  .slice(0, 10)
                  .map(([dept, count], index) => (
                    <div 
                      key={index} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        padding: '15px',
                        borderBottom: `1px solid ${INSTITUTE_COLORS.light}`,
                        backgroundColor: index % 2 === 0 ? 'white' : INSTITUTE_COLORS.lightGray
                      }}
                    >
                      <div style={{
                        width: '32px',
                        height: '32px',
                        backgroundColor: INSTITUTE_COLORS.light,
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: '15px',
                        fontWeight: '600',
                        color: INSTITUTE_COLORS.primary,
                        fontSize: '14px'
                      }}>
                        {index + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ 
                          margin: '0 0 4px 0', 
                          fontSize: '15px',
                          color: INSTITUTE_COLORS.dark,
                          fontWeight: '500'
                        }}>
                          {dept}
                        </p>
                        <p style={{ 
                          margin: 0, 
                          fontSize: '13px',
                          color: INSTITUTE_COLORS.gray
                        }}>
                          {count} заяв{count === 1 ? 'ка' : count < 5 ? 'ки' : 'ок'}
                        </p>
                      </div>
                      <div style={{
                        padding: '6px 12px',
                        backgroundColor: INSTITUTE_COLORS.light,
                        borderRadius: '20px',
                        fontSize: '14px',
                        fontWeight: '600',
                        color: INSTITUTE_COLORS.primary
                      }}>
                        {count}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div>
              <h3 style={{ 
                margin: '0 0 15px 0', 
                color: INSTITUTE_COLORS.dark,
                fontSize: '18px',
                fontWeight: '600'
              }}>
                Распределение по типам
              </h3>
              <div style={{ 
                padding: '20px',
                backgroundColor: INSTITUTE_COLORS.light,
                borderRadius: '8px',
                height: 'calc(100% - 40px)'
              }}>
                <div style={{ marginBottom: '20px' }}>
                  <p style={{ 
                    margin: '0 0 10px 0', 
                    fontSize: '15px',
                    color: INSTITUTE_COLORS.dark,
                    fontWeight: '500'
                  }}>
                    <span style={{ 
                      display: 'inline-block',
                      width: '10px',
                      height: '10px',
                      backgroundColor: INSTITUTE_COLORS.primary,
                      borderRadius: '50%',
                      marginRight: '8px'
                    }}></span>
                    Лаборатории
                  </p>
                  <p style={{ 
                    margin: 0, 
                    fontSize: '13px',
                    color: INSTITUTE_COLORS.gray,
                    lineHeight: '1.6'
                  }}>
                    Наибольшее количество заявок поступает из исследовательских лабораторий
                  </p>
                </div>
                
                <div style={{ marginBottom: '20px' }}>
                  <p style={{ 
                    margin: '0 0 10px 0', 
                    fontSize: '15px',
                    color: INSTITUTE_COLORS.dark,
                    fontWeight: '500'
                  }}>
                    <span style={{ 
                      display: 'inline-block',
                      width: '10px',
                      height: '10px',
                      backgroundColor: INSTITUTE_COLORS.secondary,
                      borderRadius: '50%',
                      marginRight: '8px'
                    }}></span>
                    Административные отделы
                  </p>
                  <p style={{ 
                    margin: 0, 
                    fontSize: '13px',
                    color: INSTITUTE_COLORS.gray,
                    lineHeight: '1.6'
                  }}>
                    Бухгалтерия, отдел кадров и другие административные подразделения
                  </p>
                </div>
                
                <div>
                  <p style={{ 
                    margin: '0 0 10px 0', 
                    fontSize: '15px',
                    color: INSTITUTE_COLORS.dark,
                    fontWeight: '500'
                  }}>
                    <span style={{ 
                      display: 'inline-block',
                      width: '10px',
                      height: '10px',
                      backgroundColor: INSTITUTE_COLORS.accent,
                      borderRadius: '50%',
                      marginRight: '8px'
                    }}></span>
                    Технические службы
                  </p>
                  <p style={{ 
                    margin: 0, 
                    fontSize: '13px',
                    color: INSTITUTE_COLORS.gray,
                    lineHeight: '1.6'
                  }}>
                    ИТ-отдел, техническая поддержка и вспомогательные службы
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Футер с информацией */}
      <div style={{ 
        marginTop: '40px',
        padding: '20px',
        backgroundColor: INSTITUTE_COLORS.light,
        borderRadius: '10px',
        fontSize: '13px',
        color: INSTITUTE_COLORS.gray,
        textAlign: 'center'
      }}>
        <p style={{ margin: '0 0 10px 0' }}>
          <strong>Институт органической химии им. Н.Н. Ворожцова СО РАН</strong><br />
          Система учёта заявок IT-службы (ИТС)
        </p>
        <p style={{ margin: 0, fontSize: '12px' }}>
          Данные обновлены: {new Date().toLocaleDateString('ru-RU', { 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </p>
      </div>
    </div>
  );
};

export default Statistics;
