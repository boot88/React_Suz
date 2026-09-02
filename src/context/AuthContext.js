import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { AUTH_STATE_KEY, LOCAL_EMPLOYEES_KEY } from '../config/authConfig';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

const AuthContext = createContext();
const AUTH_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const AUTH_ACTIVITY_EVENTS = ['mousedown', 'keydown', 'mousemove', 'scroll', 'touchstart', 'click'];

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

// Общая активность сессии в localStorage обновляется активной вкладкой.
// Позволяет не «гасить» онлайн-статус при выходе/истечении сессии в одной
// вкладке, пока тот же пользователь работает в другой.
const hasRecentSharedActivity = (withinMs = 2 * 60 * 1000) => {
  try {
    const savedState = JSON.parse(localStorage.getItem(AUTH_STATE_KEY) || 'null');
    const lastActivityAt = Number(savedState?.lastActivityAt || 0);
    return lastActivityAt > 0 && Date.now() - lastActivityAt < withinMs;
  } catch {
    return false;
  }
};

const pushPresenceToServer = async ({ isOnline }) => {
  try {
    await authFetch(`${API_BASE_URL}/auth/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isOnline })
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

  const sessionTimerRef = useRef(null);
  const lastActivityWriteRef = useRef(0);

  const persistAuthState = useCallback((nextUser, activityAt = Date.now()) => {
    if (!nextUser) {
      localStorage.removeItem(AUTH_STATE_KEY);
      return;
    }

    localStorage.setItem(
      AUTH_STATE_KEY,
      JSON.stringify({
        isAuthenticated: true,
        user: nextUser,
        lastActivityAt: activityAt,
        expiresAt: activityAt + AUTH_SESSION_TIMEOUT_MS
      })
    );
  }, []);

  const clearSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  }, []);

  const login = async (identifier, password, options = {}) => {
    const loginValue = identifier.trim();
    const loginScope = options?.scope || 'any';
    const response = await authFetch(`${API_BASE_URL}/auth/login`, {
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

    const serverRole = data?.user?.role || 'employee';
    // Администратор сохраняет полную роль независимо от точки входа (/login или /admin),
    // чтобы переписка в чате и панель управления использовали один аккаунт.
    const effectiveRole = serverRole === 'admin' ? 'admin' : serverRole;
    const employeeUser = {
      username: data?.user?.login || loginValue,
      role: effectiveRole,
      serverRole,
      name: data?.user?.full_name || data?.user?.login || loginValue,
      position: data?.user?.position || '',
      accessToken: data?.token || ''
    };

    if (loginScope === 'employee' && !['employee', 'manager', 'admin'].includes(effectiveRole)) {
      throw new Error('Неверный логин/email или пароль');
    }
    if (loginScope === 'admin' && serverRole !== 'admin') {
      throw new Error('Неверный логин/email или пароль');
    }

    const nextEmployees = upsertEmployeeOnlineStatus(employeeUser.username, true);
    mergeEmployeeDirectory(nextEmployees.filter((item) => item.isVerified));

    setIsAuthenticated(true);
    setUser(employeeUser);
    persistAuthState(employeeUser);
    await pushPresenceToServer({ login: employeeUser.username, isOnline: true, role: employeeUser.role || 'employee' });
    return employeeUser;
  };


  const changeServicePassword = async ({ currentPassword, newPassword }) => {
    const response = await authFetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Не удалось сменить пароль');
  };

  const registerEmployee = async (email, profile = {}) => {
    const normalizedEmail = email.trim().toLowerCase();
    const password = String(profile.password || '');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Введите корректный email');
    }

    if (password.length < 8) {
      throw new Error('Пароль должен содержать минимум 8 символов');
    }

    const response = await authFetch(`${API_BASE_URL}/auth/register`, {
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
        password,
        role: profile.role === 'manager' ? 'manager' : 'employee'
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

  const logout = useCallback((options = {}) => {
    if (user?.username) {
      if (user?.role === 'employee') {
        const nextEmployees = upsertEmployeeOnlineStatus(user.username, false);
        mergeEmployeeDirectory(nextEmployees.filter((item) => item.isVerified));
      }
      // При истечении сессии в фоновой вкладке не сбиваем статус, если
      // тот же пользователь всё ещё активен в другом окне (общий localStorage).
      const pushOffline = !(options?.reason === 'expired' && hasRecentSharedActivity());
      if (pushOffline) {
        pushPresenceToServer({ login: user.username, isOnline: false, role: user.role || 'employee' });
      }
    }

    clearSessionTimer();
    setIsAuthenticated(false);
    setUser(null);
    persistAuthState(null);
  }, [clearSessionTimer, mergeEmployeeDirectory, persistAuthState, user]);


  useEffect(() => {
    const syncPresence = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/auth/presence`);
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
      localStorage.removeItem('serviceAccountPasswords');
      const savedState = JSON.parse(localStorage.getItem(AUTH_STATE_KEY) || 'null');
      if (savedState?.isAuthenticated && savedState?.user?.accessToken) {
        const expiresAt = Number(savedState.expiresAt || 0);
        if (expiresAt > Date.now()) {
          setIsAuthenticated(true);
          setUser(savedState.user);
        } else {
          localStorage.removeItem(AUTH_STATE_KEY);
        }
      }
    } catch (error) {
      console.error('Ошибка при чтении состояния авторизации:', error);
      localStorage.removeItem(AUTH_STATE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      clearSessionTimer();
      return undefined;
    }

    const expireSession = () => {
      logout({ reason: 'expired' });
    };

    const scheduleExpiry = (expiresAt) => {
      clearSessionTimer();
      const delay = Math.max(0, Number(expiresAt || 0) - Date.now());
      sessionTimerRef.current = setTimeout(expireSession, delay);
    };

    const readSavedState = () => {
      try {
        return JSON.parse(localStorage.getItem(AUTH_STATE_KEY) || 'null');
      } catch {
        return null;
      }
    };

    const validateOrLogout = () => {
      const savedState = readSavedState();
      const expiresAt = Number(savedState?.expiresAt || 0);
      if (!savedState?.isAuthenticated || !savedState?.user || expiresAt <= Date.now()) {
        logout({ reason: 'expired' });
        return false;
      }
      scheduleExpiry(expiresAt);
      return true;
    };

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastActivityWriteRef.current < 1000) return;
      lastActivityWriteRef.current = now;
      persistAuthState(user, now);
      scheduleExpiry(now + AUTH_SESSION_TIMEOUT_MS);
    };

    const handleVisibilityOrFocus = () => {
      if (validateOrLogout() && !document.hidden) recordActivity();
    };

    const handleStorage = (event) => {
      if (event.key !== AUTH_STATE_KEY) return;
      validateOrLogout();
    };

    if (!validateOrLogout()) return undefined;
    recordActivity();
    AUTH_ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('storage', handleStorage);

    return () => {
      clearSessionTimer();
      AUTH_ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('storage', handleStorage);
    };
  }, [clearSessionTimer, isAuthenticated, logout, persistAuthState, user]);

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

    // Фоновая вкладка тормозит setInterval, поэтому при возврате к вкладке
    // сразу обновляем присутствие, а не ждём следующий heartbeat.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') markOnline();
    };

    markOnline();
    window.addEventListener('beforeunload', markOffline);
    window.addEventListener('pagehide', markOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', markOnline);

    const heartbeat = setInterval(markOnline, 15000);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', markOffline);
      window.removeEventListener('pagehide', markOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', markOnline);
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
