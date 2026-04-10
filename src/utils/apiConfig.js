// src/utils/apiConfig.js
export const LAN_HOST = '192.168.1.35';

export const getApiBaseCandidates = () => {
  const { protocol, hostname } = window.location;
  const host = (hostname === 'localhost' || hostname === '127.0.0.1') ? LAN_HOST : hostname;

  // Сервер может стартовать на 5000 или уйти на 5001..5010 при занятом порту
  const ports = [5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010];
  return ports.map((port) => `${protocol}//${host}:${port}/api`);
};

export const API_BASE_CANDIDATES = Array.from(new Set(getApiBaseCandidates()));
export const API_BASE_URL = API_BASE_CANDIDATES[0];
