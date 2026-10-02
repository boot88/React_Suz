import { API_BASE_URL } from './apiConfig';
import { authFetch } from './authFetch';

// Read on every file selection: a chat left open sees a new saved limit
// immediately, and a failed request never silently applies an outdated limit.
export const fetchChatUploadLimitMb = async () => {
  const response = await authFetch(`${API_BASE_URL}/settings/chat-upload-limit`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Не удалось проверить размер вложений');
  if (!Number.isInteger(data.limitMb) || data.limitMb < 10 || data.limitMb > 150) throw new Error('Не удалось проверить размер вложений');
  return data.limitMb;
};
