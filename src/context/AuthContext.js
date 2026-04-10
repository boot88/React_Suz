import { useState, useEffect, createContext, useContext } from 'react';
import { useInactivityTimer } from '../hooks/useInactivityTimer';
import { ADMIN_CREDENTIALS, AUTH_STATE_KEY, LOCAL_EMPLOYEES_KEY } from '../config/authConfig';
import { API_BASE_CANDIDATES } from '../utils/apiConfig';

const AuthContext = createContext();
const ONLINE_PING_MS = 20000;
const ONLINE_TTL_MS = 2 * 60 * 1000;

const getStoredEmployees = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_EMPLOYEES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveStoredEmployees = (employees) => {
  localStorage.setItem(LOCAL_EMPLOYEES_KEY, JSON.stringify(employees));
};

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [employeeDirectory, setEmployeeDirectory] = useState([]);

  const requestAuthApi = async (path, options = {}) => {
    let lastError = null;

    for (const baseUrl of API_BASE_CANDIDATES) {
      try {
        const response = await fetch(`${baseUrl}${path}`, options);
        const raw = await response.text();

        let payload = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch (parseError) {
          payload = { message: raw || `Некорректный ответ сервера (${response.status})` };
        }

        if (response.ok) {
          return payload;
        }

        // Пробрасываем понятную ошибку, если сервер ответил, но с ошибкой
        lastError = new Error(payload.message || `Ошибка ${response.status}`);

        // Если это proxy/html error, пробуем следующий baseUrl
        if (typeof payload.message === 'string' && payload.message.toLowerCase().includes('proxy error')) {
          continue;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Не удалось подключиться к серверу авторизации');
  };

  const persistAuthState = (nextUser) => {
    if (!nextUser) {
      localStorage.removeItem(AUTH_STATE_KEY);
      return;
    }

    localStorage.setItem(AUTH_STATE_KEY, JSON.stringify({ isAuthenticated: true, user: nextUser }));
  };

  const fetchEmployeesDirectory = async () => {
    try {
      const data = await requestAuthApi('/auth/employees');
      setEmployeeDirectory(Array.isArray(data) ? data : []);
    } catch (error) {
      const localEmployees = getStoredEmployees();
      setEmployeeDirectory(
        localEmployees.map((item) => ({
          email: item.email,
          isOnline: Boolean(item.isOnline)
            && item.lastSeen
            && (Date.now() - new Date(item.lastSeen).getTime()) < ONLINE_TTL_MS,
          lastSeen: item.lastSeen || null
        }))
      );
    }
  };

  const updatePresence = async (login, isOnline) => {
    try {
      await requestAuthApi('/auth/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, isOnline })
      });
    } catch (error) {
      const employees = getStoredEmployees();
      const nextEmployees = employees.map((item) => (
        item.email.toLowerCase() === String(login).toLowerCase()
          ? { ...item, isOnline: Boolean(isOnline), lastSeen: new Date().toISOString() }
          : item
      ));
      saveStoredEmployees(nextEmployees);
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

    let payload;
    try {
      payload = await requestAuthApi('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: loginValue, password })
      });
    } catch (apiError) {
      const localEmployee = getStoredEmployees().find(
        (item) => item.email.toLowerCase() === loginValue.toLowerCase() && item.password === password
      );

      if (!localEmployee) {
        throw apiError;
      }

      payload = {
        user: {
          login: localEmployee.email,
          role: 'employee'
        }
      };
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

    try {
      await requestAuthApi('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: normalizedEmail, password })
      });
    } catch (apiError) {
      const employees = getStoredEmployees();
      if (employees.some((item) => item.email.toLowerCase() === normalizedEmail)) {
        throw new Error('Пользователь с таким логином уже существует');
      }

      saveStoredEmployees([
        ...employees,
        {
          email: normalizedEmail,
          password,
          isOnline: false,
          lastSeen: null
        }
      ]);
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
