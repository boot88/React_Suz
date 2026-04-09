import { useState, useEffect } from 'react';
import { ApplicationsContext } from './ApplicationContext';

const ApplicationsProvider = ({ children }) => {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('http://localhost:5000/api/applications');
      
      if (!response.ok) {
        throw new Error(`Ошибка при загрузке данных: ${response.status}`);
      }
      
      const data = await response.json();
      
      // ИСПРАВЛЕНИЕ: берем только массив applications из ответа
      setApplications(data.applications || []);
      
      console.log('Загружено заявок:', data.applications?.length || 0);
      console.log('Пример заявки:', data.applications?.[0]);
      
    } catch (err) {
      setError(err.message);
      console.error('Ошибка загрузки заявок:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

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

export { ApplicationsProvider };