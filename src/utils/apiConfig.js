// src/utils/apiConfig.js
export const getApiBaseUrl = () => {
  const envApiUrl = process.env.REACT_APP_API_URL;
  if (envApiUrl) {
    return envApiUrl.replace(/\/$/, '');
  }

  const { hostname, protocol } = window.location;

  // Локальная разработка
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:5000/api';
  }

  // Render/production со встроенным API через тот же домен
  if (hostname.endsWith('onrender.com')) {
    return '/api';
  }

  // Работа в локальной сети: используем текущий хост клиента и API порт
  const apiPort = process.env.REACT_APP_API_PORT || '5000';
  return `${protocol}//${hostname}:${apiPort}/api`;
};

export const API_BASE_URL = getApiBaseUrl();
