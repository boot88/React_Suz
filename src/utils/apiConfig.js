// src/utils/apiConfig.js
export const getApiBaseUrl = () => {
  const { hostname, protocol } = window.location;

  // Development/local network: используем текущий хост, чтобы localhost и LAN-IP вели в один и тот же backend
  if (hostname === 'localhost' || hostname === '127.0.0.1' || /^192\\.168\\./.test(hostname)) {
    return `${protocol}//${hostname}:5000/api`;
  }
  
  // Для продакшена (Render) - используем относительный путь
  return '/api';
};

export const API_BASE_URL = getApiBaseUrl();
