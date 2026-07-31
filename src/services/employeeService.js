// src/services/employeeService.js
//const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

/*
const getApiBaseUrl = () => {
  // Если мы в development и на localhost - используем localhost
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:5000';
  }
  // Иначе используем текущий хост с портом 5000
  return `http://${window.location.hostname}:5000`;
};

const API_BASE_URL = getApiBaseUrl();
*/


// Поиск сотрудников
export const searchEmployees = async (field, query) => {
  try {
    const response = await authFetch(
      `${API_BASE_URL}/employees/search?field=${field}&query=${encodeURIComponent(query)}`
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Ошибка при поиске сотрудников');
    }

    return await response.json();
  } catch (error) {
    console.error('Error searching employees:', error);
    throw error;
  }
};

// Получение всех отделов
export const getDepartments = async () => {
  try {
    const response = await authFetch(`${API_BASE_URL}/employees/departments`);

    if (!response.ok) {
      throw new Error('Ошибка при получении отделов');
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting departments:', error);
    throw error;
  }
};

// Получение всех сотрудников (опционально)
export const getAllEmployees = async () => {
  try {
    const response = await authFetch(`${API_BASE_URL}/employees/search?field=full_name&query=`);

    if (!response.ok) {
      throw new Error('Ошибка при получении сотрудников');
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting employees:', error);
    throw error;
  }
};

// Ручное обновление справочника сотрудников
export const syncEmployees = async () => {
  try {
    const response = await authFetch(`${API_BASE_URL}/employees/sync`, {
      method: 'POST'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Ошибка при обновлении справочника сотрудников');
    }

    return data;
  } catch (error) {
    console.error('Error syncing employees:', error);
    throw error;
  }
};
