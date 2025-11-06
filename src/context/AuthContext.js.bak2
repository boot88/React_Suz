import { useState, useEffect, createContext, useContext } from 'react';
import { useInactivityTimer } from '../hooks/useInactivityTimer';

const AuthContext = createContext();

export const useAuth = () => {
  return useContext(AuthContext);
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Logout function
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setIsAuthenticated(false);
  };

  // Inactivity timer: will call logout after delay
  const { resetTimer, clearTimer } = useInactivityTimer(logout);

  // Login function - calls backend
  const login = async (username, password) => {
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: username, password })
      });
      if (!resp.ok) {
        const data = await resp.json().catch(()=>({message:'Ошибка'}));
        throw new Error(data.message || 'Ошибка при входе');
      }
      const data = await resp.json();
      // Save token and user
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      setIsAuthenticated(true);
      resetTimer();
      return { success: true };
    } catch (err) {
      console.error('Login error', err);
      return { success: false, message: err.message };
    }
  };

  // On mount, try to restore user from localStorage
  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
        setIsAuthenticated(true);
      } catch (e) {
        console.error('Failed parse saved user', e);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }
    setIsLoading(false);
    // setup timers cleanup
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  // Wrap value
  const value = {
    isAuthenticated,
    user,
    login,
    logout,
    isLoading,
    resetTimer
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
