import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import { authFetch } from '../utils/authFetch';

export default function useNewApplicationCount(user) {
  const login = user?.username || user?.name || '';
  const baseTitle = useRef(document.title.replace(/^\(\d+\)\s*/, ''));
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!login) return undefined;
    const originalTitle = baseTitle.current;
    let active = true, busy = false, pending = false, connected = false;
    let stream;
    const controller = new AbortController();
    const apply = value => {
      if (!active) return;
      const next = Math.max(0, Math.floor(Number(value) || 0));
      setCount(next);
      document.title = next ? `(${next}) ${originalTitle}` : originalTitle;
    };
    apply(0);
    const refresh = async () => {
      if (!active) return;
      if (busy) { pending = true; return; }
      busy = true;
      try {
        const response = await authFetch(`${API_BASE_URL}/applications/unseen-count?admin_login=${encodeURIComponent(login)}`, { signal: controller.signal });
        const data = await response.json();
        if (response.ok && data.count != null && Number.isFinite(Number(data.count))) apply(data.count);
      } catch { /* Keep the last confirmed count during a network outage. */ }
      finally {
        busy = false;
        if (pending && active) { pending = false; refresh(); }
      }
    };
    refresh();
    if (user?.accessToken && typeof EventSource !== 'undefined') {
      stream = new EventSource(`${API_BASE_URL}/applications/stream?access_token=${encodeURIComponent(user.accessToken)}`);
      stream.addEventListener('ready', () => { connected = true; refresh(); });
      stream.addEventListener('application', refresh);
      stream.onerror = () => { connected = false; };
    }
    // Polling also works in a background tab when the event stream is absent.
    const interval = setInterval(() => { if (!connected) refresh(); }, 5000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener('applications:refresh', refresh);
    window.addEventListener('applications:viewed', refresh);
    window.addEventListener('applications:status-changed', refresh);
    return () => {
      active = false;
      controller.abort(); stream?.close(); clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('applications:refresh', refresh);
      window.removeEventListener('applications:viewed', refresh);
      window.removeEventListener('applications:status-changed', refresh);
      document.title = originalTitle;
    };
  }, [login, user?.accessToken]);
  return login ? count : 0;
}
