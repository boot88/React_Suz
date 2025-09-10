// src/utils/apiConfig.js
export const getApiBaseUrl = () => {
  const { hostname } = window.location;
  
  // Если мы в development (localhost или локальный IP)
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '192.168.1.35') {
    return 'http://192.168.1.35:5000/api';
  }
  
  // Для продакшена (Render) - используем относительный путь
  return '/api';
};

export const API_BASE_URL = getApiBaseUrl();