// Короткоживущие media-токены для URL файлов (?mt=...).
// Храним в памяти, чтобы не класть полный access_token в URL вложений.
import { API_BASE_URL } from './apiConfig';

const MEDIA_TOKEN_TTL_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;

const tokenCache = new Map(); // fileId -> { token, expiresAt }

const getCachedMediaToken = (fileId = '') => {
  try { const token = JSON.parse(localStorage.getItem('authState') || 'null')?.user?.accessToken || ''; if (token !== cacheOwner) return ''; } catch { return ''; }
  const key = String(fileId || '').trim();
  if (!key) return '';
  const entry = tokenCache.get(key);
  if (!entry || Number(entry.expiresAt) <= Date.now() + REFRESH_EARLY_MS) {
    tokenCache.delete(key);
    return '';
  }
  return entry.token;
};

const storeMediaToken = (fileId, token, expiresAt) => {
  const key = String(fileId || '').trim();
  if (!key || !token) return;
  tokenCache.set(key, {
    token,
    expiresAt: Number(expiresAt) || Date.now() + MEDIA_TOKEN_TTL_MS
  });
};

// Асинхронно запрашивает media-токены для набора файлов.
// Используется при загрузке переписок/ленты, чтобы к моменту рендера
// вложений в URL уже был короткоживущий токен вместо полного access_token.
let cacheOwner = '';
const inFlight = new Map();
const requestTokenBatch = (batch, accessToken) => {
  return fetch(`${API_BASE_URL}/chat/files/media-tokens`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: batch })
    }).then(async response => {
      if (!response.ok || cacheOwner !== accessToken) return;
      const data = await response.json();
      if (cacheOwner !== accessToken) return;
      (data.tokens || []).forEach(item => storeMediaToken(item.fileId, item.token, item.expiresAt));
    }).catch(() => {}).finally(() => { if (cacheOwner === accessToken) batch.forEach(id => inFlight.delete(id)); });
};
const ensureMediaTokens = async ({ fileIds = [], getToken = () => '' }) => {
  const accessToken = getToken();
  if (!accessToken) return;
  if (cacheOwner !== accessToken) { tokenCache.clear(); inFlight.clear(); cacheOwner = accessToken; }
  const ids = [...new Set(fileIds.map(String).filter(Boolean))].filter(id => !getCachedMediaToken(id));
  const missing = ids.filter(id => !inFlight.has(id));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    const request = requestTokenBatch(batch, accessToken);
    batch.forEach(id => inFlight.set(id, request));
  }
  await Promise.all(ids.map(id => inFlight.get(id)));
};

const getFileIdFromUrl = (url = '') => {
  const match = String(url).match(/\/api\/chat\/files\/([^/?#]+)\/download/i);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

export {
  getCachedMediaToken,
  storeMediaToken,
  ensureMediaTokens,
  getFileIdFromUrl,
  MEDIA_TOKEN_TTL_MS
};
