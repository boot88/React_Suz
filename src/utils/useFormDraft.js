import { useEffect, useRef } from 'react';
import { activePreferencesLogin } from './userPreferences';

export const readFormDraft = (key, fallback) => {
  try { return JSON.parse(sessionStorage.getItem(`draft:${activePreferencesLogin()}:${key}`)) || fallback; }
  catch { return fallback; }
};
export const useFormDraft = (key, value, dirty) => {
  const suppressed = useRef(false);
  const wasDirty = useRef(false);
  const latest = useRef(null);
  latest.current = { key, value, dirty, login: activePreferencesLogin() };
  const persistRef = useRef(null);
  persistRef.current = () => {
    if (suppressed.current) return;
    const draft = latest.current;
    try {
      const storageKey = `draft:${draft.login}:${draft.key}`;
      if (draft.dirty) sessionStorage.setItem(storageKey, JSON.stringify(draft.value));
      else if (wasDirty.current) sessionStorage.removeItem(storageKey);
    } catch { /* Full browser storage must not prevent saving the form. */ }
  };
  useEffect(() => {
    suppressed.current = false;
    if (dirty) wasDirty.current = true;
    const timer = setTimeout(() => persistRef.current(), 300);
    return () => clearTimeout(timer);
  }, [key, value, dirty]);
  useEffect(() => {
    const warn = (event) => {
      persistRef.current();
      if (latest.current.dirty && !suppressed.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { persistRef.current(); window.removeEventListener('beforeunload', warn); };
  }, []);
  return () => {
    suppressed.current = true;
    try { sessionStorage.removeItem(`draft:${latest.current.login}:${key}`); } catch {}
  };
};
