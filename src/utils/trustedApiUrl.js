import { API_BASE_URL } from './apiConfig';

export const isTrustedApiUrl = (value) => {
  try {
    const api = new URL(API_BASE_URL, window.location.origin);
    const url = new URL(value, window.location.origin);
    const base = api.pathname.replace(/\/$/, '');
    return url.origin === api.origin && (url.pathname === base || url.pathname.startsWith(`${base}/`));
  } catch { return false; }
};
