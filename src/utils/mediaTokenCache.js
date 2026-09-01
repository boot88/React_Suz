// Короткоживущие media-токены для URL файлов (?mt=...).
// Храним в памяти, чтобы не класть полный access_token в URL вложений.
import { API_BASE_URL } from './apiConfig';

const MEDIA_TOKEN_TTL_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;

const tokenCache = new Map(); // fileId -> { token, expiresAt }

const getCachedMediaToken = (fileId = '') => {
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
const ensureMediaTokens = async ({ fileIds = [], scope = 'chat', getToken = () => '' }) => {
  const uniqueIds = [...new Set(
    (Array.isArray(fileIds) ? fileIds : [])
      .map((fileId) => String(fileId || '').trim())
      .filter(Boolean)
      .filter((fileId) => !getCachedMediaToken(fileId))
  )];
  if (!uniqueIds.length) return;

  const accessToken = typeof getToken === 'function' ? getToken() : '';
  if (!accessToken) return;

  await Promise.all(uniqueIds.map(async (fileId) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/chat/files/${encodeURIComponent(fileId)}/media-token`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ scope })
        }
      );
      if (!response.ok) return;
      const data = await response.json();
      if (data?.token) storeMediaToken(fileId, data.token, data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + MEDIA_TOKEN_TTL_MS);
    } catch {
      // Сетевая ошибка: следующий рендер повторит попытку либо использует access_token.
    }
  }));
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
