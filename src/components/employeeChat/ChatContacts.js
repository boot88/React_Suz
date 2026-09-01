import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

const CONTACT_ROW_HEIGHT = 82;
const CONTACT_OVERSCAN = 6;

const ChatContacts = memo(function ChatContacts({
  employees,
  selectedEmail,
  currentLogin,
  managerLogin,
  isManager,
  unreadByEmail,
  favorites,
  pinnedDialogs,
  getConversationId,
  formatVisibleLogin,
  t,
  onSelect,
  onOpenProfile,
  onTogglePinned,
  onToggleFavorite
}) {
  const viewportRef = useRef(null);
  const [viewportHeight, setViewportHeight] = useState(520);
  const [scrollTop, setScrollTop] = useState(0);
  const favoriteSet = useMemo(() => new Set(favorites || []), [favorites]);
  const pinnedSet = useMemo(() => new Set(pinnedDialogs || []), [pinnedDialogs]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const updateHeight = () => setViewportHeight(viewport.clientHeight || 520);
    updateHeight();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateHeight) : null;
    observer?.observe(viewport);
    return () => observer?.disconnect();
  }, []);

  if (!employees.length) return <div className="empty-mini">{t('noResults')}</div>;

  const startIndex = Math.max(0, Math.floor(scrollTop / CONTACT_ROW_HEIGHT) - CONTACT_OVERSCAN);
  const endIndex = Math.min(
    employees.length,
    Math.ceil((scrollTop + viewportHeight) / CONTACT_ROW_HEIGHT) + CONTACT_OVERSCAN
  );

  return (
    <div
      ref={viewportRef}
      className="virtual-contact-viewport"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="virtual-contact-spacer" style={{ height: employees.length * CONTACT_ROW_HEIGHT }}>
        {employees.slice(startIndex, endIndex).map((employee, offset) => {
          const index = startIndex + offset;
    const email = String(employee.email || '');
    const conversationId = getConversationId(currentLogin, email);
    const isOnline = Boolean(employee.isOnline);
    const isManagerContact = ['manager', 'admin'].includes(String(employee.role || '').toLowerCase())
      || email.toLowerCase() === String(managerLogin || '').toLowerCase();
    const profile = employee.profile || {};

    return (
      <div
        key={email}
        className={`employee-chat-user ${selectedEmail === email ? 'active' : ''} ${isManagerContact ? 'manager-priority' : ''} ${favoriteSet.has(email) ? 'favorite' : ''} ${pinnedSet.has(conversationId) ? 'pinned-dialog' : ''}`}
        style={{ transform: `translateY(${index * CONTACT_ROW_HEIGHT}px)` }}
      >
        <button type="button" className="employee-contact-open" onClick={() => onSelect(email)}>
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
          <span className="employee-chat-user-main">
            <span className="employee-chat-user-email">{profile.full_name || email}</span>
            <span className="employee-chat-user-extra">
              {formatVisibleLogin(email)} · {profile.department || t('departmentMissing')} · {t('cabinetShort')}. {profile.room || '—'}
            </span>
          </span>
          {(isManagerContact || isOnline) && (
            <span className="employee-chat-user-status">{isManagerContact ? t('admin') : t('online')}</span>
          )}
          {unreadByEmail[email] > 0 && <span className="employee-chat-user-unread">{unreadByEmail[email]}</span>}
        </button>
        <span className="contact-card-actions">
          <button type="button" className="profile-open-btn" onClick={() => onOpenProfile(email)}>{t('profile')}</button>
          <button type="button" className="favorite-contact-btn" aria-label={t('pinDialog')} onClick={() => onTogglePinned(conversationId)}>
            {pinnedSet.has(conversationId) ? '📌' : '📍'}
          </button>
          <button type="button" className="favorite-contact-btn" aria-label={t('favorite')} onClick={() => onToggleFavorite(email)}>
            {favoriteSet.has(email) ? '★' : '☆'}
          </button>
        </span>
      </div>
    );
        })}
      </div>
    </div>
  );
});

export default ChatContacts;
