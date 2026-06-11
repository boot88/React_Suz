import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { useInactivityTimer } from '../hooks/useInactivityTimer';
import { ADMIN_CREDENTIALS, MANAGER_CREDENTIALS, AUTH_STATE_KEY, LOCAL_EMPLOYEES_KEY } from '../config/authConfig';
import { API_BASE_URL } from '../utils/apiConfig';

const AuthContext = createContext();
const SERVICE_PASSWORDS_KEY = 'serviceAccountPasswords';

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

const readServicePasswords = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SERVICE_PASSWORDS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const getServicePassword = (login, fallbackPassword) => readServicePasswords()[login] || fallbackPassword;

const saveServicePassword = (login, password) => {
  const passwords = readServicePasswords();
  localStorage.setItem(SERVICE_PASSWORDS_KEY, JSON.stringify({ ...passwords, [login]: password }));
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

  const mergeEmployeeDirectory = useCallback((items) => {
    const nextItems = Array.isArray(items) ? items : [];
    setEmployeeDirectory((prev) => {
      const merged = new Map((prev || []).map((item) => [String(item.email || '').toLowerCase(), item]));
      nextItems.forEach((item) => {
        const email = String(item.email || item.login || '').toLowerCase();
        if (!email) return;
        merged.set(email, {
          ...(merged.get(email) || {}),
          ...item,
          email,
          isOnline: Boolean(item.isOnline),
          lastSeen: item.lastSeen || merged.get(email)?.lastSeen || null,
          role: item.role || merged.get(email)?.role || 'employee'
        });
      });
      return [...merged.values()];
    });
  }, []);

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
      (item) => item.username === loginValue && getServicePassword(item.username, item.password) === password
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

    if (loginValue === MANAGER_CREDENTIALS.username && password === getServicePassword(MANAGER_CREDENTIALS.username, MANAGER_CREDENTIALS.password)) {
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
    mergeEmployeeDirectory(nextEmployees.filter((item) => item.isVerified));

    setIsAuthenticated(true);
    setUser(employeeUser);
    persistAuthState(employeeUser);
    await pushPresenceToServer({ login: employeeUser.username, isOnline: true, role: employeeUser.role || 'employee' });
    return employeeUser;
  };


  const changeServicePassword = async ({ login: accountLogin, currentPassword, newPassword }) => {
    const normalizedLogin = String(accountLogin || '').trim();
    const admin = ADMIN_CREDENTIALS.find((item) => item.username === normalizedLogin);
    const isManager = normalizedLogin === MANAGER_CREDENTIALS.username;
    const fallbackPassword = admin?.password || (isManager ? MANAGER_CREDENTIALS.password : '');

    if (!fallbackPassword) {
      throw new Error('Служебная учётная запись не найдена');
    }

    if (getServicePassword(normalizedLogin, fallbackPassword) !== currentPassword) {
      throw new Error('Текущий пароль указан неверно');
    }

    if (String(newPassword || '').length < 8) {
      throw new Error('Новый пароль должен содержать минимум 8 символов');
    }

    saveServicePassword(normalizedLogin, newPassword);
  };

  const registerEmployee = async (email, profile = {}) => {
    const normalizedEmail = email.trim().toLowerCase();
    const password = String(profile.password || '');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Введите корректный email');
    }

    if (ADMIN_CREDENTIALS.some((admin) => admin.username.toLowerCase() === normalizedEmail) || MANAGER_CREDENTIALS.username.toLowerCase() === normalizedEmail) {
      throw new Error('Этот логин зарезервирован для служебной учетной записи');
    }

    if (password.length < 8) {
      throw new Error('Пароль должен содержать минимум 8 символов');
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
        room: profile.room || null,
        password
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
        mergeEmployeeDirectory(nextEmployees.filter((item) => item.isVerified));
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

      mergeEmployeeDirectory(
        normalizedEmployees
          .filter((item) => item.isVerified)
          .map((item) => ({
            email: item.email,
            isOnline: Boolean(item.isOnline),
            lastSeen: item.lastSeen || null,
            role: item.role || 'employee'
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
  }, [mergeEmployeeDirectory]);

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

    const markOnline = () => {
      const nextEmployees = upsertEmployeeOnlineStatus(user.username, true);
      const currentEmployee = nextEmployees.find((item) => item.email.toLowerCase() === user.username.toLowerCase());
      if (currentEmployee) {
        mergeEmployeeDirectory([{ ...currentEmployee, role: user.role || 'employee' }]);
      }
      pushPresenceToServer({ login: user.username, isOnline: true, role: user.role || 'employee' });
    };

    const markOffline = () => {
      const nextEmployees = upsertEmployeeOnlineStatus(user.username, false);
      const currentEmployee = nextEmployees.find((item) => item.email.toLowerCase() === user.username.toLowerCase());
      if (currentEmployee) {
        mergeEmployeeDirectory([{ ...currentEmployee, role: user.role || 'employee' }]);
      }
      pushPresenceToServer({ login: user.username, isOnline: false, role: user.role || 'employee' });
    };

    markOnline();
    window.addEventListener('beforeunload', markOffline);

    const heartbeat = setInterval(markOnline, 15000);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', markOffline);
    };
  }, [mergeEmployeeDirectory, user]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        isLoading,
        login,
        logout,
        registerEmployee,
        changeServicePassword,
        verifyEmployeeEmail,
        employeeDirectory
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
