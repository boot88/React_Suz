import { useEffect, useRef, useCallback } from 'react';

const LAST_ACTIVITY_KEY = 'lastActivityAt';

export const useInactivityTimer = (
  logout,
  delay = 15 * 60 * 1000,
  enabled = true
) => {
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const getLastActivity = useCallback(() => {
    const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      return stored;
    }
    return Date.now();
  }, []);

  const scheduleTimeout = useCallback(() => {
    if (!enabled) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const elapsed = Date.now() - getLastActivity();
    const remaining = Math.max(delay - elapsed, 0);

    timeoutRef.current = setTimeout(() => {
      logout();
    }, remaining);
  }, [delay, enabled, getLastActivity, logout]);

  const markActivity = useCallback(() => {
    if (!enabled) {
      return;
    }

    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    scheduleTimeout();
  }, [enabled, scheduleTimeout]);

  const checkInactivity = useCallback(() => {
    if (!enabled) {
      return;
    }

    const lastActivity = getLastActivity();
    if (Date.now() - lastActivity >= delay) {
      logout();
      return;
    }

    scheduleTimeout();
  }, [delay, enabled, getLastActivity, logout, scheduleTimeout]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      localStorage.removeItem(LAST_ACTIVITY_KEY);
      return;
    }

    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    }

    const activityEvents = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'wheel'
    ];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener('focus', checkInactivity);
    document.addEventListener('visibilitychange', checkInactivity);
    window.addEventListener('pageshow', checkInactivity);
    window.addEventListener('storage', checkInactivity);

    scheduleTimeout();
    intervalRef.current = setInterval(checkInactivity, 30 * 1000);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      window.removeEventListener('focus', checkInactivity);
      document.removeEventListener('visibilitychange', checkInactivity);
      window.removeEventListener('pageshow', checkInactivity);
      window.removeEventListener('storage', checkInactivity);
      clearTimers();
    };
  }, [checkInactivity, clearTimers, enabled, markActivity, scheduleTimeout]);

  return { markActivity, clearTimers, checkInactivity };
};
