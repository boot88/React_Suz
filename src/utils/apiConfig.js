// src/utils/apiConfig.js
export const getApiBaseCandidates = () => {
  const { protocol, hostname } = window.location;

  const directHost = `${protocol}//${hostname}:5000/api`;
  const localhost = `${protocol}//localhost:5000/api`;
  const lanFallback = `${protocol}//192.168.1.35:5000/api`;

  // Первый вариант — относительный (через proxy), затем прямые адреса
  return ['/api', directHost, localhost, lanFallback];
};

export const API_BASE_CANDIDATES = Array.from(new Set(getApiBaseCandidates()));
export const API_BASE_URL = API_BASE_CANDIDATES[0];
