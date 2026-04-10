import { useState, useEffect, createContext, useContext } from 'react';
import { useInactivityTimer } from '../hooks/useInactivityTimer';
import { ADMIN_CREDENTIALS, AUTH_STATE_KEY, LOCAL_EMPLOYEES_KEY } from '../config/authConfig';

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

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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
      return adminUser;
    }

    const employees = getStoredEmployees();
    const employee = employees.find(
      (item) => item.email.toLowerCase() === loginValue.toLowerCase()
    );

    if (!employee || employee.password !== password) {
      throw new Error('Неверный логин/email или пароль');
    }

    if (!employee.isVerified) {
      throw new Error('Email не подтвержден. Завершите подтверждение в регистрации.');
    }

    const employeeUser = {
      username: employee.email,
      role: 'employee',
      name: employee.email
    };

    setIsAuthenticated(true);
    setUser(employeeUser);
    persistAuthState(employeeUser);
    return employeeUser;
  };

  const registerEmployee = (email, password) => {
    const normalizedEmail = email.trim().toLowerCase();
    const employees = getStoredEmployees();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Введите корректный email');
    }

    if (employees.some((item) => item.email.toLowerCase() === normalizedEmail)) {
      throw new Error('Сотрудник с таким email уже зарегистрирован');
    }

    if (ADMIN_CREDENTIALS.some((admin) => admin.username.toLowerCase() === normalizedEmail)) {
      throw new Error('Этот логин зарезервирован для администратора');
    }

    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const nextEmployees = [
      ...employees,
      {
        email: normalizedEmail,
        password,
        isVerified: false,
        verificationCode,
        createdAt: new Date().toISOString()
      }
    ];

    saveEmployees(nextEmployees);

    return {
      email: normalizedEmail,
      verificationCode
    };
  };

  const verifyEmployeeEmail = (email, verificationCode) => {
    const normalizedEmail = email.trim().toLowerCase();
    const employees = getStoredEmployees();
    const employeeIndex = employees.findIndex((item) => item.email.toLowerCase() === normalizedEmail);

    if (employeeIndex === -1) {
      throw new Error('Пользователь не найден');
    }

    if (employees[employeeIndex].verificationCode !== verificationCode.trim()) {
      throw new Error('Неверный код подтверждения');
    }

    employees[employeeIndex] = {
      ...employees[employeeIndex],
      isVerified: true,
      verificationCode: null,
      verifiedAt: new Date().toISOString()
    };

    saveEmployees(employees);
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUser(null);
    persistAuthState(null);
  };

  useInactivityTimer(logout, 15 * 60 * 1000);

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

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        isLoading,
        login,
        logout,
        registerEmployee,
        verifyEmployeeEmail
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
