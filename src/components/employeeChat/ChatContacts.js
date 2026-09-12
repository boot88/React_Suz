import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import AuthenticatedAvatar from './AuthenticatedAvatar';
import ChatIcon from './ChatIcon';
import MessageActionPopover from './MessageActionPopover';

const CONTACT_ROW_HEIGHT = 82;
const CONTACT_OVERSCAN = 6;

const ChatContacts = memo(function ChatContacts({
  modern = false, resetKey = '', summaries = {}, mutedDialogs = [], onRestore,
  theme = 'light', getEmployeeAvatar,
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
  const [openMenu, setOpenMenu] = useState(null);
  const hasEmployees = employees.length > 0;
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
  }, [hasEmployees]);

  useEffect(() => {
    setScrollTop(0);
    setOpenMenu(null);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [resetKey, modern]);

  useEffect(() => {
    // Unread/online filters can shrink while the user is near the end of the list.
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScroll = Math.max(0, employees.length * CONTACT_ROW_HEIGHT - viewportHeight);
    if (viewport.scrollTop > maxScroll) viewport.scrollTop = maxScroll;
    setScrollTop(viewport.scrollTop);
  }, [employees.length, viewportHeight]);

  useEffect(() => { setOpenMenu(null); }, [selectedEmail]);

  if (!employees.length) return <div className="empty-mini">{t('noResults')}</div>;

  const startIndex = Math.min(
    Math.max(0, employees.length - Math.ceil(viewportHeight / CONTACT_ROW_HEIGHT)),
    Math.max(0, Math.floor(scrollTop / CONTACT_ROW_HEIGHT) - CONTACT_OVERSCAN)
  );
  const endIndex = Math.min(
    employees.length,
    Math.ceil((scrollTop + viewportHeight) / CONTACT_ROW_HEIGHT) + CONTACT_OVERSCAN
  );

  const menuEmployee = openMenu && employees.find(employee => employee.email === openMenu.email);
  const menuConversationId = menuEmployee && getConversationId(currentLogin, menuEmployee.email);
  const runMenuAction = action => { setOpenMenu(null); action(); };

  return (<>
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

    if (modern) {
      const summary = summaries[conversationId];
      const preview = summary?.lastMessage?.deletedAt ? (t('contacts') === 'Контакты' ? 'Сообщение удалено' : 'Message deleted') : summary?.lastMessage?.text || (summary?.attachmentsCount ? '📎' : profile.department || formatVisibleLogin(email));
      return <div key={email} className={`employee-chat-user modern-contact ${selectedEmail === email ? 'active' : ''}`} style={{ transform: `translateY(${index * CONTACT_ROW_HEIGHT}px)` }}>
        <button type="button" className="modern-contact-avatar" aria-label={`${t('profile')}: ${profile.full_name || email}`} onClick={() => onOpenProfile(email)}><AuthenticatedAvatar src={getEmployeeAvatar?.(email, profile.avatar) || ''} alt="" fallback={<span>{(profile.full_name || email).slice(0, 1)}</span>} /><i className={`status-dot ${isOnline ? 'online' : 'offline'}`} /></button>
        <button type="button" className="modern-contact-body" aria-current={selectedEmail === email ? 'true' : undefined} onClick={() => onSelect(email)}><strong>{pinnedSet.has(conversationId) && <ChatIcon name="pin" size={12} />}{profile.full_name || email}</strong><small>{preview}</small></button>
        <div className="modern-contact-meta"><time>{summary?.lastAt ? new Date(summary.lastAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</time>
          {unreadByEmail[email] > 0 && <b className={mutedDialogs.includes(conversationId) ? 'muted-badge' : ''}>{unreadByEmail[email]}</b>}
          <button type="button" className="modern-contact-menu-trigger" aria-label={`${t('dialogActions')}: ${profile.full_name || email}`} aria-haspopup="dialog" aria-expanded={openMenu?.email === email} onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            setOpenMenu(openMenu?.email === email ? null : { email, anchor: event.currentTarget, style: { left: rect.right - 240, top: rect.bottom + 6, width: 'min(240px, calc(100vw - 16px))' } });
          }}><ChatIcon name="more" /></button>
        </div>
      </div>;
    }
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
          {onRestore && <button type="button" onClick={() => onRestore(conversationId)}>↩</button>}
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
    {modern && menuEmployee && <MessageActionPopover theme={theme} style={openMenu.style} anchor={openMenu.anchor} label={`${t('dialogActions')}: ${menuEmployee.profile?.full_name || menuEmployee.email}`} onClose={() => setOpenMenu(null)}>
      <div className="modern-menu-actions">
        <button type="button" onClick={() => runMenuAction(() => onTogglePinned(menuConversationId))}><ChatIcon name="pin" />{pinnedSet.has(menuConversationId) ? t('unpinDialog') : t('pinDialog')}</button>
        <button type="button" aria-pressed={favoriteSet.has(menuEmployee.email)} onClick={() => runMenuAction(() => onToggleFavorite(menuEmployee.email))}>{favoriteSet.has(menuEmployee.email) ? '★' : '☆'} {t('favorite')}</button>
        {onRestore && <button type="button" onClick={() => runMenuAction(() => onRestore(menuConversationId))}><ChatIcon name="reply" />{t('contacts') === 'Контакты' ? 'Вернуть в диалоги' : 'Restore'}</button>}
      </div>
    </MessageActionPopover>}
  </>);
});

export default ChatContacts;
