// src/utils/apiConfig.js
export const getApiBaseUrl = () => {
  const { hostname } = window.location;

  // Явный override через env (если задан)
  if (process.env.REACT_APP_API_BASE_URL) {
    return process.env.REACT_APP_API_BASE_URL;
  }

  // Development: используем тот же host, что открыт в браузере (localhost или LAN-IP)
  if (hostname === 'localhost' || hostname === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return `http://${hostname}:5000/api`;
  }

  // Production: относительный путь
  return '/api';
};

export const API_BASE_URL = getApiBaseUrl();
