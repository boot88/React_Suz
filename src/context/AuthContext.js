import { useState, useEffect, createContext, useContext } from 'react';
import { useInactivityTimer } from '../hooks/useInactivityTimer';

const AuthContext = createContext();

export const useAuth = () => {
  return useContext(AuthContext);
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // Добавляем состояние загрузки

  const login = (username) => {
    setIsAuthenticated(true);
    setUser(username);
    localStorage.setItem('isAuthenticated', 'true');
    localStorage.setItem('user', username);
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUser(null);
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('user');
  };

  // Используем хук для таймера неактивности
  useInactivityTimer(logout, 15 * 60 * 1000);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const auth = localStorage.getItem('isAuthenticated');
        const userData = localStorage.getItem('user');
        
        if (auth === 'true' && userData) {
          setIsAuthenticated(true);
          setUser(userData);
        }
      } catch (error) {
        console.error('Ошибка при чтении из localStorage:', error);
      } finally {
        setIsLoading(false); // Завершаем загрузку независимо от результата
      }
    };

    checkAuth();
  }, []);

  const value = {
    isAuthenticated,
    user,
    login,
    logout,
    isLoading // Добавляем состояние загрузки в контекст
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};