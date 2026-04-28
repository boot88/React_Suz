import { useState, useEffect, createContext, useContext } from 'react';
import { useInactivityTimer } from '../hooks/useInactivityTimer';
import { ADMIN_CREDENTIALS, MANAGER_CREDENTIALS, AUTH_STATE_KEY, LOCAL_EMPLOYEES_KEY } from '../config/authConfig';
import { API_BASE_URL } from '../utils/apiConfig';

const AuthContext = createContext();

const getStoredEmployees = () => {
  try {
    const employees = JSON.parse(localStorage.getItem(LOCAL_EMPLOYEES_KEY) || '[]');
    return Array.isArray(employees) ? employees : [];
  } catch (error) {
    console.error('Ошибка чтения списка сотрудников:', error);
    return [];
  }
};

const saveEmployees = (employees) => {
  localStorage.setItem(LOCAL_EMPLOYEES_KEY, JSON.stringify(employees));
};

const pushPresenceToServer = async ({ login, isOnline, role }) => {
  try {
    await fetch(`${API_BASE_URL}/auth/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, isOnline, role })
    });
  } catch (error) {
    console.error('Ошибка отправки presence на сервер:', error);
  }
};

const upsertEmployeeOnlineStatus = (email, isOnline) => {
  const employees = getStoredEmployees();
  const normalizedEmail = email.trim().toLowerCase();
  const existingIndex = employees.findIndex((item) => item.email.toLowerCase() === normalizedEmail);
  const now = new Date().toISOString();

  if (existingIndex === -1) {
    employees.push({
      email: normalizedEmail,
      isVerified: true,
      isOnline,
      lastSeen: now,
      createdAt: now
    });
  } else {
    employees[existingIndex] = {
      ...employees[existingIndex],
      isVerified: true,
      isOnline,
      lastSeen: now
    };
  }

  saveEmployees(employees);
  return employees;
};

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

    localStorage.setItem(
      AUTH_STATE_KEY,
      JSON.stringify({
        isAuthenticated: true,
        user: nextUser
      })
    );
  };

  const login = async (identifier, password) => {
    const loginValue = identifier.trim();

    const admin = ADMIN_CREDENTIALS.find(
      (item) => item.username === loginValue && item.password === password
    );

    if (admin) {
      const adminUser = {
        username: admin.username,
        role: 'admin',
        name: admin.name
      };

      setIsAuthenticated(true);
      setUser(adminUser);
      persistAuthState(adminUser);
      await pushPresenceToServer({ login: adminUser.username, isOnline: true, role: 'admin' });
      return adminUser;
    }

    if (loginValue === MANAGER_CREDENTIALS.username && password === MANAGER_CREDENTIALS.password) {
      const managerUser = {
        username: MANAGER_CREDENTIALS.username,
        role: 'manager',
        name: MANAGER_CREDENTIALS.name
      };

      setIsAuthenticated(true);
      setUser(managerUser);
      persistAuthState(managerUser);
      await pushPresenceToServer({ login: managerUser.username, isOnline: true, role: 'manager' });
      return managerUser;
    }

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login: loginValue,
        password
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Неверный логин/email или пароль');
    }

    const employeeUser = {
      username: data?.user?.login || loginValue,
      role: data?.user?.role || 'employee',
      name: data?.user?.full_name || data?.user?.login || loginValue
    };

    const nextEmployees = upsertEmployeeOnlineStatus(employeeUser.username, true);
    setEmployeeDirectory(nextEmployees.filter((item) => item.isVerified));

    setIsAuthenticated(true);
    setUser(employeeUser);
    persistAuthState(employeeUser);
    await pushPresenceToServer({ login: employeeUser.username, isOnline: true, role: employeeUser.role || 'employee' });
    return employeeUser;
  };

  const registerEmployee = async (email, profile = {}) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Введите корректный email');
    }

    if (ADMIN_CREDENTIALS.some((admin) => admin.username.toLowerCase() === normalizedEmail) || MANAGER_CREDENTIALS.username.toLowerCase() === normalizedEmail) {
      throw new Error('Этот логин зарезервирован для служебной учетной записи');
    }

    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        login: normalizedEmail,
        full_name: profile.fullName?.trim() || normalizedEmail,
        department: profile.department || null,
        phone: profile.internalPhone || null,
        room: profile.room || null
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Ошибка регистрации');
    }

    return {
      email: normalizedEmail
    };
  };

  const verifyEmployeeEmail = () => true;

  const logout = () => {
    if (user?.username) {
      if (user?.role === 'employee') {
        const nextEmployees = upsertEmployeeOnlineStatus(user.username, false);
        setEmployeeDirectory(nextEmployees.filter((item) => item.isVerified));
      }
      pushPresenceToServer({ login: user.username, isOnline: false, role: user.role || 'employee' });
    }

    setIsAuthenticated(false);
    setUser(null);
    persistAuthState(null);
  };

  useInactivityTimer(logout, 15 * 60 * 1000);

  useEffect(() => {
    const syncPresence = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/presence`);
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data?.presence)) return;

        setEmployeeDirectory(
          data.presence.map((item) => ({
            email: (item.email || '').toLowerCase(),
            isOnline: Boolean(item.isOnline),
            lastSeen: item.lastSeen || null,
            role: item.role || 'employee'
          }))
        );
      } catch (error) {
        console.error('Ошибка синхронизации presence:', error);
      }
    };

    syncPresence();
    const interval = setInterval(syncPresence, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateDirectory = () => {
      const employees = getStoredEmployees();
      const now = Date.now();
      let changed = false;
      const normalizedEmployees = employees.map((item) => {
        const lastSeenTimestamp = item.lastSeen ? new Date(item.lastSeen).getTime() : 0;
        const isStaleOnline = Boolean(item.isOnline) && (!lastSeenTimestamp || now - lastSeenTimestamp > 2 * 60 * 1000);

        if (isStaleOnline) {
          changed = true;
          return { ...item, isOnline: false };
        }

        return item;
      });

      if (changed) {
        saveEmployees(normalizedEmployees);
      }

      setEmployeeDirectory(
        normalizedEmployees
          .filter((item) => item.isVerified)
          .map((item) => ({
            email: item.email,
            isOnline: Boolean(item.isOnline),
            lastSeen: item.lastSeen || null
          }))
      );
    };

    updateDirectory();

    const onStorage = (event) => {
      if (event.key === LOCAL_EMPLOYEES_KEY) {
        updateDirectory();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
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
    if (!user?.username) return undefined;

    const markOffline = () => {
      upsertEmployeeOnlineStatus(user.username, false);
      pushPresenceToServer({ login: user.username, isOnline: false, role: user.role || 'employee' });
    };

    window.addEventListener('beforeunload', markOffline);

    const heartbeat = setInterval(() => {
      const nextEmployees = upsertEmployeeOnlineStatus(user.username, true);
      setEmployeeDirectory(nextEmployees.filter((item) => item.isVerified));
      pushPresenceToServer({ login: user.username, isOnline: true, role: user.role || 'employee' });
    }, 20000);

    return () => {
      clearInterval(heartbeat);
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
        employeeDirectory
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
