import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Portaled menus need their own design tokens and viewport positioning.
export default function MessageActionPopover({ children, theme, style, label, onClose, anchor }) {
  const menuRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = document.activeElement;
    const fit = () => {
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft || 0) + 8;
      const topEdge = (viewport?.offsetTop || 0) + 8;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      menu.style.maxHeight = `${Math.max(80, height - 16)}px`;
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(leftEdge, Math.min(parseFloat(style.left) || leftEdge, leftEdge + width - rect.width - 16))}px`;
      menu.style.top = `${Math.max(topEdge, Math.min(parseFloat(style.top) || topEdge, topEdge + height - rect.height - 16))}px`;
    };
    fit();
    menu.querySelector('button')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(fit);
    observer.observe(menu);
    const dismiss = event => {
      if (!menu.contains(event.target) && !anchor?.contains(event.target)) closeRef.current();
    };
    const keys = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        trigger?.focus?.({ preventScroll: true });
      }
      if (!menu.contains(event.target)) return;
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
      if (direction) {
        event.preventDefault();
        buttons[(index + direction + buttons.length) % buttons.length]?.focus();
      }
      if (event.key === 'Tab') closeRef.current();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('scroll', dismiss, true);
    document.addEventListener('keydown', keys);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('keydown', keys);
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      if (menu.contains(document.activeElement)) trigger?.focus?.({ preventScroll: true });
    };
  }, [style, anchor]);

  return createPortal(<div ref={menuRef} className={`modern-message-popover modern-chat-surface theme-${theme || 'light'}`} style={style} role="dialog" aria-label={label} onClick={event => event.stopPropagation()}>{children}</div>, document.body);
}
