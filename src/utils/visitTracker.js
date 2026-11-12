// Учёт посещений в браузере. Одна сессия — одна вкладка: после 30 минут
// бездействия начинается новая, чтобы журнал не склеивал разные визиты.
import { API_BASE_URL } from './apiConfig';
import { getStoredAccessToken } from './authFetch';

const STORAGE_KEY = 'niochVisitorSession';
const HEARTBEAT_MS = 30000;
const IDLE_RESET_MS = 30 * 60 * 1000;
const MIN_FLUSH_INTERVAL_MS = 1000;
const MAX_PENDING_PAGES = 25;

let session = null;
let started = false;
let timerId = null;
let flushTimer = null;
let inFlight = false;
let flushQueued = false;
let forceFlushQueued = false;
let lastSentAt = 0;
let currentPath = '';
let currentTitle = '';
let pendingPages = [];
let identityKey = '';
let identityToken = '';

const now = () => Date.now();

const createSessionId = () => {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
    if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Ниже — запасной вариант для старых браузеров без Web Crypto.
  }
  return `${now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 32);
};

const readStoredSession = () => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(parsed.id || ''))) return null;
    return parsed;
  } catch {
    return null;
  }
};

const persist = () => {
  if (!session) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, identityKey, lastActivityAt: now() }));
  } catch {
    // Приватный режим может запрещать sessionStorage — на учёт это не влияет.
  }
};

const currentLocationPath = () => `${window.location.pathname}${window.location.search}`;

const readUtm = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get('utm_source') || '',
      medium: params.get('utm_medium') || '',
      campaign: params.get('utm_campaign') || ''
    };
  } catch {
    return { source: '', medium: '', campaign: '' };
  }
};

const buildSession = (previous) => {
  const timestamp = now();
  const screen = window.screen ? `${window.screen.width}x${window.screen.height}` : '';
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    timezone = '';
  }
  const resumed = previous && timestamp - Number(previous.lastActivityAt || 0) <= IDLE_RESET_MS;
  if (resumed) {
    return {
      ...previous,
      activeSeconds: Math.max(0, Number(previous.activeSeconds) || 0),
      lastActivityAt: timestamp,
      screen: previous.screen || screen,
      language: previous.language || navigator.language || '',
      timezone: previous.timezone || timezone
    };
  }
  return {
    id: createSessionId(),
    startedAt: timestamp,
    activeSeconds: 0,
    lastActivityAt: timestamp,
    landingPath: currentLocationPath(),
    referrer: document.referrer || '',
    utm: readUtm(),
    screen,
    language: navigator.language || '',
    timezone
  };
};

const requeue = (pages) => {
  if (!pages.length) return;
  pendingPages = [...pages, ...pendingPages].slice(0, MAX_PENDING_PAGES);
};

const scheduleFlush = (delay = 0, force = false) => {
  if (!started) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flush(force); }, delay);
};

const flush = async (sync = false, tokenOverride = null) => {
  if (!started || !session) return;
  if (inFlight) {
    flushQueued = true;
    if (sync) forceFlushQueued = true;
    return;
  }
  const timestamp = now();
  if (!sync && timestamp - lastSentAt < MIN_FLUSH_INTERVAL_MS) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, MIN_FLUSH_INTERVAL_MS - (timestamp - lastSentAt));
    return;
  }

  const pages = pendingPages.slice(0, MAX_PENDING_PAGES);
  pendingPages = pendingPages.slice(pages.length);
  const token = tokenOverride === null ? getStoredAccessToken() : tokenOverride;
  const sentSessionId = session.id;
  const body = {
    sessionId: session.id,
    activeSeconds: session.activeSeconds,
    path: currentPath || session.landingPath || '/',
    pages,
    referrer: session.referrer,
    utm: session.utm,
    language: session.language,
    timezone: session.timezone,
    screen: session.screen
  };

  inFlight = true;
  lastSentAt = timestamp;
  try {
    const response = await fetch(`${API_BASE_URL}/visits/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      keepalive: sync
    });
    if (!response.ok && response.status !== 204 && session?.id === sentSessionId) requeue(pages);
  } catch {
    // Не возвращаем страницы в очередь, если визит уже сменился: они
    // относятся к предыдущему аккаунту и не должны попасть в новый.
    if (session?.id === sentSessionId) requeue(pages);
  } finally {
    inFlight = false;
    persist();
    if (flushQueued) {
      flushQueued = false;
      const force = forceFlushQueued;
      forceFlushQueued = false;
      scheduleFlush(0, force);
    } else if (pendingPages.length) {
      scheduleFlush(MIN_FLUSH_INTERVAL_MS);
    }
  }
};

const queuePage = (path, title) => {
  if (!path) return;
  if (pendingPages.length >= MAX_PENDING_PAGES) pendingPages.shift();
  pendingPages.push({ path, title: title || '' });
  scheduleFlush(0);
};

// Вход другого аккаунта в той же вкладке должен стать отдельным визитом.
// Иначе сервер обновит login у текущей сессии, и предыдущий пользователь
// исчезнет из журнала (например, сотрудник после повторного входа админа).
const startNewVisitSession = () => {
  session = buildSession(null);
  currentPath = currentLocationPath();
  currentTitle = document.title || '';
  pendingPages = currentPath ? [{ path: currentPath, title: currentTitle }] : [];
  persist();
  flush(true);
};

const handleVisibility = () => {
  if (document.visibilityState === 'hidden') flush(true);
};

const handlePageHide = () => {
  flush(true);
};


export const startVisitTracking = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (started) return stopVisitTracking;
  started = true;
  const previous = readStoredSession();
  session = buildSession(previous);
  // Продолжаем тот же визит только после перезагрузки в пределах 30 минут;
  // сохранённая личность помогает не перезаписать прошлый аккаунт.
  identityKey = previous && session.id === previous.id ? String(previous.identityKey || '') : '';
  identityToken = '';
  currentPath = currentLocationPath();
  currentTitle = document.title || '';
  pendingPages = [];
  queuePage(currentPath, currentTitle);
  persist();
  // Личность при первом ping ещё не определена: токен отправит эффект
  // setVisitUser, чтобы после перезагрузки не перезаписать прошлый аккаунт.
  flush(false, '');

  timerId = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    session.activeSeconds += 1;
    persist();
    if (now() - lastSentAt >= HEARTBEAT_MS) flush();
  }, 1000);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);

  return stopVisitTracking;
};

export const stopVisitTracking = () => {
  if (!started) return;
  flush(true);
  started = false;
  if (timerId) clearInterval(timerId);
  if (flushTimer) clearTimeout(flushTimer);
  timerId = null;
  flushTimer = null;
  document.removeEventListener('visibilitychange', handleVisibility);
  window.removeEventListener('pagehide', handlePageHide);
};

export const setVisitPath = (path, title = '') => {
  if (!started || !session) return;
  const nextPath = String(path || '');
  if (!nextPath) return;
  if (nextPath === currentPath) {
    if (title) currentTitle = title;
    return;
  }
  currentPath = nextPath;
  currentTitle = title || '';
  queuePage(nextPath, currentTitle);
};

export const setVisitUser = (user) => {
  if (!started || !session) return;
  const nextKey = user ? `${user.username || user.login || ''}:${user.role || ''}` : '';
  const nextToken = String(user?.accessToken || '').trim() || getStoredAccessToken();
  if (nextKey === identityKey) {
    const needsIdentityPing = Boolean(user) && !identityToken;
    if (user) identityToken = nextToken;
    if (needsIdentityPing) flush(true, nextToken);
    return;
  }
  const previousKey = identityKey;
  const previousToken = identityToken;
  identityKey = nextKey;
  identityToken = nextToken;
  // Закрываем прошлый визит токеном прежнего аккаунта: при быстром переключении
  // localStorage уже содержит новый токен, и старая строка иначе перезапишется.
  flush(true, previousKey ? previousToken : nextToken);
  // После выхода или смены аккаунта начинаем новый визит. При первом входе
  // (previousKey пуст) текущая гостевая сессия просто получает личность.
  if (previousKey) startNewVisitSession();
};

export const resetVisitTrackingForTests = () => {
  stopVisitTracking();
  session = null;
  pendingPages = [];
  identityKey = '';
  identityToken = '';
  lastSentAt = 0;
  forceFlushQueued = false;
};

