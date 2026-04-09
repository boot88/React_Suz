// src/utils/apiConfig.js
export const getApiBaseUrl = () => {
  const envApiUrl = process.env.REACT_APP_API_URL;
  if (envApiUrl && (envApiUrl.startsWith('http') || envApiUrl.startsWith('/'))) {
    return envApiUrl.replace(/\/$/, '');
  }

  const { hostname, protocol } = window.location;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isLanIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);

  if (isLocalhost) {
    return 'http://localhost:5000/api';
  }

  if (isLanIp) {
    return `${protocol}//${hostname}:5000/api`;
  }

  // Для production и reverse-proxy сценариев
  return '/api';
};

export const API_BASE_URL = getApiBaseUrl();
