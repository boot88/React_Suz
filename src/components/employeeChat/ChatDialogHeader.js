import React, { memo, useRef, useState } from 'react';
import ChatIcon from './ChatIcon';
import MessageActionPopover from './MessageActionPopover';

const ChatDialogHeader = memo(function ChatDialogHeader({
  t,
  modern = false,
  theme = 'light',
  isPinned = false,
  isMuted = false,
  contactName,
  visibleLogin,
  search,
  hasSearch,
  searchIndex,
  searchCount,
  showMediaPanel,
  showConversationMenu,
  conversationMenuOpen,
  onSearch,
  onPreviousResult,
  onNextResult,
  onToggleMediaPanel,
  onToggleMenu,
  onCloseMenu,
  onArchive,
  onHide,
  onPin,
  onMarkUnread,
  onMute,
  onClearDraft,
  onDeleteConversation,
  canDeleteConversation = false
}) {
  const [menuStyle, setMenuStyle] = useState({ left: 8, top: 8 });
  const menuTriggerRef = useRef(null);
  const menuActions = <>
    <button type="button" onClick={onArchive}>{t('archiveDialog')}</button>
    <button type="button" onClick={onHide}>{t('hideDialog')}</button>
    <button type="button" onClick={onPin}>{isPinned ? t('unpinDialog') : t('pinDialogAction')}</button>
    <button type="button" onClick={onMarkUnread}>{t('markUnread')}</button>
    <button type="button" onClick={onMute}>{isMuted ? t('unmuteNotifications') : t('muteNotifications')}</button>
    <button type="button" onClick={onClearDraft}>{t('clearDraft')}</button>
    {canDeleteConversation && <button type="button" className="danger-action" onClick={onDeleteConversation}>{t('deleteConversation')}</button>}
  </>;
  return (
    <header className="conversation-header">
      <div className="conversation-identity">
        <span className="eyebrow">{t('dialog')}</span>
        <h2>{contactName}</h2>
        <p>{visibleLogin}</p>
      </div>
      <div className="conversation-tools">
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t('dialogSearch')} aria-label={t('dialogSearch')} />
        {hasSearch && <span className="dialog-search-count">{searchCount ? searchIndex + 1 : 0} {t('of')} {searchCount}</span>}
        <button type="button" disabled={!searchCount} aria-label={t('back')} onClick={onPreviousResult}>↑</button>
        <button type="button" disabled={!searchCount} aria-label={t('searchingMessages')} onClick={onNextResult}>↓</button>
        {showMediaPanel && <button type="button" onClick={onToggleMediaPanel}>{t('mediaFiles')}</button>}
        {showConversationMenu && (modern ? <>
          <button ref={menuTriggerRef} type="button" className="modern-dialog-menu-trigger" aria-label={t('dialogActions')} aria-haspopup="dialog" aria-expanded={conversationMenuOpen} onClick={event => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuStyle({ left: rect.right - 260, top: rect.bottom + 8, width: 'min(260px, calc(100vw - 16px))' });
            onToggleMenu();
          }}><ChatIcon name="more" size={22} /></button>
          {conversationMenuOpen && <MessageActionPopover theme={theme} style={menuStyle} anchor={menuTriggerRef.current} label={t('dialogActions')} onClose={onCloseMenu}>
            <div className="modern-menu-actions">{menuActions}</div>
          </MessageActionPopover>}
        </> : (
          <details className="conversation-menu" open={conversationMenuOpen} onClick={(event) => event.stopPropagation()}>
            <summary
              aria-label={t('dialogActions')}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleMenu();
              }}
            >
              ⋯
            </summary>
            <div className="conversation-menu-popover">
              {menuActions}
            </div>
          </details>
        ))}
      </div>
    </header>
  );
});

export default ChatDialogHeader;
