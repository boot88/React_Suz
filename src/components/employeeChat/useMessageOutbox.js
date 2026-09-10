import { useEffect, useRef } from 'react';

// One worker per mounted account. State changes and SSE echoes cannot start a
// second send. Persisted errors stay in the outbox until explicitly retried.
export default function useMessageOutbox({ login, online, items, setItems, send, onSending, onSaved, onFailed }) {
  const latest = useRef({ items, send, onSending, onSaved, onFailed });
  latest.current = { items, send, onSending, onSaved, onFailed };
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    let timer;
    const pump = async () => {
      if (!active) return;
      const item = latest.current.items.find(entry => entry.message.deliveryStatus !== 'error' && (entry.nextAttemptAt || 0) <= Date.now());
      if (online && item && !busy.current) {
        busy.current = true;
        latest.current.onSending?.(item);
        try {
          const saved = await latest.current.send(item.conversationId, item.message);
          if (active) {
            latest.current.onSaved(item, saved);
            setItems(current => current.filter(entry => entry.message.id !== item.message.id));
          }
        } catch (error) {
          if (active) {
            const retryable = !error.status || error.status >= 500 || error.status === 429;
            const attempts = (item.attempts || 0) + 1;
            const next = { ...item, attempts, nextAttemptAt: Date.now() + Math.min(60000, 1000 * (2 ** Math.min(attempts, 6))),
              message: { ...item.message, deliveryStatus: retryable ? 'waiting' : 'error', deliveryError: error.message } };
            setItems(current => current.map(entry => entry.message.id === item.message.id ? next : entry));
            latest.current.onFailed(next);
          }
        } finally { busy.current = false; }
      }
      if (active) timer = window.setTimeout(pump, 500);
    };
    pump();
    return () => { active = false; window.clearTimeout(timer); };
  }, [login, online, setItems]);
}
