import { useState, useEffect } from 'react';
import { ApplicationsContext } from './ApplicationContext';

const ApplicationsProvider = ({ children }) => {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('http://localhost:5000/api/applications');
      
      if (!response.ok) {
        throw new Error('Ошибка при загрузке данных');
      }
      
      const data = await response.json();
      setApplications(data);
    } catch (err) {
      setError(err.message);
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