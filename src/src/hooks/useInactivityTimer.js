import { useEffect, useRef, useCallback } from 'react';

export const useInactivityTimer = (logout, delay = 15 * 60 * 1000) => {
  const timerRef = useRef(null);
  const isNavigatingRef = useRef(false);

  const resetTimer = useCallback(() => {
    // Не сбрасываем таймер во время навигации
    if (isNavigatingRef.current) return;
    
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    
    timerRef.current = setTimeout(() => {
      logout();
    }, delay);
  }, [logout, delay]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Отслеживаем клики по ссылкам
  useEffect(() => {
    const handleLinkClick = (e) => {
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        isNavigatingRef.current = true;
        setTimeout(() => {
          isNavigatingRef.current = false;
        }, 100);
      }
    };

    document.addEventListener('click', handleLinkClick);
    
    return () => {
      document.removeEventListener('click', handleLinkClick);
    };
  }, []);

  useEffect(() => {
    const events = ['mousedown', 'keypress', 'mousemove', 'scroll', 'touchstart'];
    
    events.forEach(event => {
      document.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, resetTimer);
      });
      clearTimer();
    };
  }, [resetTimer, clearTimer]);

  return { resetTimer, clearTimer };
};