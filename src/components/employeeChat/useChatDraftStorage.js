import { useEffect, useRef } from 'react';

const prefix = login => `chatDraft:${encodeURIComponent(login)}:`;
const saved = new Map();
export const readChatDrafts = (login = 'guest') => {
  try {
    const drafts = { ...(JSON.parse(localStorage.getItem('chatDrafts') || '{}')[login] || {}) };
    const keyPrefix = prefix(login);
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(keyPrefix)) {
        try { drafts[decodeURIComponent(key.slice(keyPrefix.length))] = JSON.parse(localStorage.getItem(key)); } catch { /* skip corrupt draft */ }
      }
    }
    return drafts;
  } catch { return {}; }
};

export const saveChatDrafts = (login = 'guest', drafts = {}) => {
  try {
    const previous = saved.get(login) || {};
    const next = {};
    Object.entries(drafts).forEach(([id, draft]) => {
      next[id] = JSON.stringify(draft);
      if (next[id] !== previous[id]) localStorage.setItem(prefix(login) + encodeURIComponent(id), next[id]);
    });
    Object.keys(previous).forEach(id => { if (!(id in next)) localStorage.removeItem(prefix(login) + encodeURIComponent(id)); });
    saved.set(login, next);
    // Migrate only this account; other users' drafts must remain untouched.
    const legacy = JSON.parse(localStorage.getItem('chatDrafts') || '{}');
    if (legacy[login]) { delete legacy[login]; localStorage.setItem('chatDrafts', JSON.stringify(legacy)); }
  } catch { /* Storage may be unavailable; the in-memory draft remains. */ }
};

export default function useChatDraftStorage(login, drafts) {
  const latest = useRef(drafts);
  latest.current = drafts;
  useEffect(() => {
    const timer = setTimeout(() => saveChatDrafts(login, drafts), 400);
    return () => clearTimeout(timer);
  }, [login, drafts]);
  useEffect(() => {
    const flush = () => saveChatDrafts(login, latest.current);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [login]);
}
