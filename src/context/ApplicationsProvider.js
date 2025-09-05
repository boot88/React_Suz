// context/ApplicationsProvider.js
import { useState, useEffect } from 'react';
import { ApplicationsContext } from './ApplicationContext';

const ApplicationsProvider = ({ children }) => {
  // Состояние для хранения заявок
  const [applications, setApplications] = useState([]);
  
  // Состояние для отображения загрузки
  const [loading, setLoading] = useState(true);
  
  // Состояние для обработки ошибок
  const [error, setError] = useState(null);

  // Функция для получения всех заявок
  const fetchApplications = async () => {
    try {
      setLoading(true);
      
      // Отправляем запрос к API
      const response = await fetch('http://localhost:5000/api/applications');
      
      // Проверяем успешность запроса
      if (!response.ok) {
        throw new Error('Ошибка при загрузке данных');
      }
      
      // Получаем данные в формате JSON
      const data = await response.json();
      
      // Сохраняем полученные заявки
      setApplications(data);
    } catch (err) {
      // Обрабатываем ошибку
      setError(err.message);
    } finally {
      // Снимаем состояние загрузки
      setLoading(false);
    }
  };

  // Загружаем данные при монтировании компонента
  useEffect(() => {
    fetchApplications();
  }, []);

  // Создаем объект с данными для контекста
  const contextValue = {
    applications,
    setApplications,
    loading,
    error,
    fetchApplications
  };

  return (
    <ApplicationsContext.Provider value={contextValue}>
      {children}
    </ApplicationsContext.Provider>
  );
};

// Исправленный экспорт
export { ApplicationsProvider };
