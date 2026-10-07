// src/utils/apiConfig.js
export const getApiBaseUrl = () => {
  const { hostname } = window.location;

  // Явный override через env (если задан)
  if (process.env.REACT_APP_API_BASE_URL) {
    return process.env.REACT_APP_API_BASE_URL;
  }

  // Боевая сборка: клиент и API отдаёт один и тот же сервер, поэтому берём
  // относительный путь — он подставит текущий хост и порт. Так смена порта
  // (5000 -> 3000) и вход по имени (el_ap_sys) работают без пересборки.
  if (process.env.NODE_ENV === "production") {
    return "/api";
  }

  // Development: используем тот же host, что открыт в браузере (localhost или LAN-IP)
  if (hostname === 'localhost' || hostname === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const port = Number(process.env.REACT_APP_API_PORT || 5000);
    return `http://${hostname}:${Number.isInteger(port) && port > 0 && port <= 65535 ? port : 5000}/api`;
  }

  // Production: относительный путь
  return '/api';
};

export const API_BASE_URL = getApiBaseUrl();
