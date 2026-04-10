// src/utils/apiConfig.js
export const LAN_HOST = '192.168.1.35';

export const getApiBaseCandidates = () => {
  const { protocol, hostname } = window.location;
  const lanUrl = `${protocol}//${LAN_HOST}:5000/api`;

  // Для локальной разработки и сети всегда используем один backend (LAN host),
  // чтобы localhost и LAN-IP работали с одной и той же БД.
  if (hostname === 'localhost' || hostname === '127.0.0.1' || /^192\.168\./.test(hostname)) {
    return [lanUrl, '/api'];
  }

  return ['/api'];
};

export const API_BASE_CANDIDATES = Array.from(new Set(getApiBaseCandidates()));
export const API_BASE_URL = API_BASE_CANDIDATES[0];
