const AUTH_STATE_KEY = 'authState';

export const getStoredAccessToken = () => {
  try {
    const state = JSON.parse(localStorage.getItem(AUTH_STATE_KEY) || 'null');
    return String(state?.user?.accessToken || '').trim();
  } catch {
    return '';
  }
};

export const withAccessToken = (url = '') => {
  const token = getStoredAccessToken();
  if (!url || !token || url.startsWith('data:') || url.startsWith('blob:')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
};

export const authFetch = (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  const token = getStoredAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
};
