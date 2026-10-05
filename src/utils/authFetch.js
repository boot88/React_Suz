import { isTrustedApiUrl } from './trustedApiUrl';
import { getCachedMediaToken, getFileIdFromUrl } from './mediaTokenCache';
import { API_BASE_URL } from './apiConfig';

const AUTH_STATE_KEY = 'authState';
let sessionCheckState = { token: '', promise: null };

export const getStoredAccessToken = () => {
  try {
    const state = JSON.parse(localStorage.getItem(AUTH_STATE_KEY) || 'null');
    return String(state?.user?.accessToken || '').trim();
  } catch {
    return '';
  }
};

// Ответ 401 у одного запроса ещё не означает, что сессия завершена: аккаунт мог
// быть пересоздан синхронизацией справочника, а запрос — обратиться к ресурсу
// с ограниченным доступом. Перед выходом подтверждаем сессию отдельной
// проверкой, чтобы не выбрасывать пользователя на страницу входа.
export const confirmSessionActive = (token = '') => {
  const normalized = String(token || '').trim();
  if (!normalized) return Promise.resolve(false);
  if (sessionCheckState.token === normalized && sessionCheckState.promise) return sessionCheckState.promise;

  const promise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/session`, {
        headers: { Authorization: `Bearer ${normalized}` }
      });
    if (response.status === 401 || response.status === 403) return false;
      // 204 — сессия действует; сетевые сбои и 5xx не подтверждают её конец.
      return true;
    } catch {
      return true;
    }
  })();

  sessionCheckState = { token: normalized, promise };
  promise.finally(() => { if (sessionCheckState.promise === promise) sessionCheckState = { token: '', promise: null }; });
  return promise;
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
  return fetch(input, { ...init, headers }).then(async (response) => {
    if (response.status === 503 && isTrustedApiUrl(typeof input === 'string' ? input : input.url) && !String(input).includes('/backups/status')) {
      response.clone().json().then((data) => { if (String(data.message || '').includes('резервное копирование')) window.dispatchEvent(new CustomEvent('admin:maintenance', { detail: { active: true } })); }).catch(() => {});
    }
    if (response.status === 401 && token && getStoredAccessToken() === token && !String(input).includes('/auth/login')) {
      const stillActive = await confirmSessionActive(token);
      if (!stillActive) window.dispatchEvent(new Event('auth:expired'));
    }
    return response;
  });
};
