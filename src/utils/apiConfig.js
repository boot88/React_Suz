// src/utils/apiConfig.js
export const getApiBaseUrl = () => {
  const envApiUrl = process.env.REACT_APP_API_URL;
  if (envApiUrl && (envApiUrl.startsWith('http') || envApiUrl.startsWith('/'))) {
    return envApiUrl.replace(/\/$/, '');
  }
  
  // Универсальный дефолт: в development используется CRA proxy, в production — same-origin /api.
  return '/api';
};

export const API_BASE_URL = getApiBaseUrl();
