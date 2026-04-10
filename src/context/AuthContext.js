import { useState, useEffect, createContext, useContext } from 'react';
import { useInactivityTimer } from '../hooks/useInactivityTimer';
import { ADMIN_CREDENTIALS, AUTH_STATE_KEY } from '../config/authConfig';
import { API_BASE_URL } from '../utils/apiConfig';

const AuthContext = createContext();
const ONLINE_PING_MS = 20000;

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [employeeDirectory, setEmployeeDirectory] = useState([]);

  const persistAuthState = (nextUser) => {
    if (!nextUser) {
      localStorage.removeItem(AUTH_STATE_KEY);
      return;
    }

    localStorage.setItem(AUTH_STATE_KEY, JSON.stringify({ isAuthenticated: true, user: nextUser }));
  };

  const fetchEmployeesDirectory = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/employees`);
      if (!response.ok) return;

      const data = await response.json();
      setEmployeeDirectory(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Ошибка загрузки списка сотрудников:', error);
    }
  };

  const updatePresence = async (login, isOnline) => {
    try {
      await fetch(`${API_BASE_URL}/auth/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, isOnline })
      });
    } catch (error) {
      console.error('Ошибка обновления presence:', error);
    }
  };

  const login = async (identifier, password) => {
    const loginValue = identifier.trim();

    const admin = ADMIN_CREDENTIALS.find(
      (item) => item.username === loginValue && item.password === password
    );

    if (admin) {
      const adminUser = { username: admin.username, role: 'admin', name: admin.name };
      setIsAuthenticated(true);
      setUser(adminUser);
      persistAuthState(adminUser);
      return adminUser;
    }

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginValue, password })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || 'Неверный логин/email или пароль');
    }

    const employeeUser = {
      username: payload.user.login,
      role: payload.user.role,
      name: payload.user.login
    };

    if (employeeUser.role !== 'employee') {
      throw new Error('Этот аккаунт не является сотрудником');
    }

    setIsAuthenticated(true);
    setUser(employeeUser);
    persistAuthState(employeeUser);
    await updatePresence(employeeUser.username, true);
    await fetchEmployeesDirectory();

    return employeeUser;
  };

  const registerEmployee = async (email, password) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Введите корректный email');
    }

    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: normalizedEmail, password })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || 'Ошибка регистрации');
    }

    await fetchEmployeesDirectory();

    return { email: normalizedEmail, verificationCode: '000000' };
  };

  const verifyEmployeeEmail = async () => true;

  const logout = () => {
    if (user?.role === 'employee') {
      updatePresence(user.username, false);
    }

    setIsAuthenticated(false);
    setUser(null);
    persistAuthState(null);
  };

  useInactivityTimer(logout, 15 * 60 * 1000);

  useEffect(() => {
    fetchEmployeesDirectory();
  }, []);

  useEffect(() => {
    try {
      const savedState = JSON.parse(localStorage.getItem(AUTH_STATE_KEY) || 'null');
      if (savedState?.isAuthenticated && savedState?.user) {
        setIsAuthenticated(true);
        setUser(savedState.user);
      }
    } catch (error) {
      console.error('Ошибка при чтении состояния авторизации:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'employee') return undefined;

    updatePresence(user.username, true);
    const timer = setInterval(() => {
      updatePresence(user.username, true);
      fetchEmployeesDirectory();
    }, ONLINE_PING_MS);

    const markOffline = () => {
      updatePresence(user.username, false);
    };

    window.addEventListener('beforeunload', markOffline);

    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', markOffline);
    };
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        isLoading,
        login,
        logout,
        registerEmployee,
        verifyEmployeeEmail,
        employeeDirectory,
        refreshEmployeesDirectory: fetchEmployeesDirectory
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
