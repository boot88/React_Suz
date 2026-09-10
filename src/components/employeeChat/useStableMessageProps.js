import { useRef } from 'react';

// Event functions keep their identity but always call the latest render's
// implementation. Actual data changes still invalidate memoized message rows.
export default function useStableMessageProps(values) {
  const latest = useRef(values);
  latest.current = values;
  const callbacks = useRef({});
  const previous = useRef(null);
  const next = {};
  Object.entries(values).forEach(([key, value]) => {
    if (typeof value === 'function' && !/^[A-Z]/.test(key)) {
      if (!callbacks.current[key]) callbacks.current[key] = (...args) => latest.current[key](...args);
      next[key] = callbacks.current[key];
    } else next[key] = value;
  });
  if (!previous.current || Object.keys(next).some(key => next[key] !== previous.current[key])) previous.current = next;
  return previous.current;
}
