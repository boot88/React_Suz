import { isTrustedApiUrl } from './trustedApiUrl';
import { getCachedMediaToken, getFileIdFromUrl } from './mediaTokenCache';

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
  if (!url || !token || !isTrustedApiUrl(url)) return url;

  // Для файлов чата предпочитаем короткоживущий media-токен, чтобы полный
  // access_token не попадал в URL (история браузера, рефереры, логи).
  const fileId = getFileIdFromUrl(url);
  const mediaToken = fileId ? getCachedMediaToken(fileId) : '';

  // Один и тот же файл проходит через предпросмотр, публикацию и повторную
  // загрузку ленты. Заменяем прежние access_token/mt, а не дописываем ещё
  // один: два параметра делают адрес недействительным для сервера.
  try {
    const isAbsolute = /^https?:\/\//i.test(url);
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.delete('access_token');
    parsed.searchParams.delete('mt');
    if (mediaToken) parsed.searchParams.set('mt', mediaToken);
    else parsed.searchParams.set('access_token', token);
    return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const separator = url.includes('?') ? '&' : '?';
    return mediaToken
      ? `${url}${separator}mt=${encodeURIComponent(mediaToken)}`
      : `${url}${separator}access_token=${encodeURIComponent(token)}`;
  }
};

export const authFetch = (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  const token = getStoredAccessToken();
  if (token && isTrustedApiUrl(typeof input === 'string' ? input : input.url) && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers }).then((response) => {
    if (response.status === 401 && token && getStoredAccessToken() === token && !String(input).includes('/auth/login')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    return response;
  });
};
