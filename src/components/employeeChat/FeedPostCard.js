import React, { memo, useEffect, useRef } from 'react';
import ChatIcon from './ChatIcon';
import FeedComments from './FeedComments';
import AuthenticatedAvatar from './AuthenticatedAvatar';

const FeedPostCard = memo(function FeedPostCard({
  post,
  modern = false,
  searchCurrent = false,
  searchQuery = '',
  onCloseMenu,
  selected,
  menuOpen,
  mutationPending,
  canManage,
  canPin,
  authorLogin,
  authorName,
  authorMeta,
  authorAvatar,
  authorInitial,
  editing,
  editingText,
  attachments,
  mediaAttachmentCount,
  singlePhoto,
  reactionEmojis,
  reactionExpanded,
  comments,
  totalComments,
  hiddenCommentsCount,
  commentsExpanded,
  commentDraft,
  currentLogin,
  currentAvatar,
  currentName,
  isManager,
  isAdmin,
  isEnglish,
  interfaceLocale,
  t,
  getEmployeeAvatar,
  formatLogin,
  isMediaAttachment,
  MediaCard,
  AttachmentCard,
  onOpenProfile,
  onToggleMenu,
  onStartEdit,
  onEditText,
  onSaveEdit,
  onCancelEdit,
  onPin,
  onCopyLink,
  onShare,
  onQuote,
  onHide,
  onDelete,
  onOpenMedia,
  onToggleReaction,
  onCloseReactionPicker,
  onSelect,
  onExpandReactions,
  onReplyComment,
  onDeleteComment,
  onToggleComments,
  onCommentDraftChange,
  onSubmitComment
}) {
  const menuButtonRef = useRef(null);
  const closeMenuRef = useRef(onCloseMenu);
  closeMenuRef.current = onCloseMenu;
  const highlightSearchText = (text = '') => {
    const source = String(text || '');
    const query = String(searchQuery || '').trim();
    if (query.length < 2) return source;
    const lowerSource = source.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    const parts = [];
    let cursor = 0;
    let index = lowerSource.indexOf(lowerQuery, cursor);
    while (index >= 0) {
      if (index > cursor) parts.push(source.slice(cursor, index));
      parts.push(<mark key={`${index}-${parts.length}`}>{source.slice(index, index + query.length)}</mark>);
      cursor = index + query.length;
      index = lowerSource.indexOf(lowerQuery, cursor);
    }
    if (!parts.length) return source;
    if (cursor < source.length) parts.push(source.slice(cursor));
    return parts;
  };
  useEffect(() => {
    if (!modern || !menuOpen) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') { closeMenuRef.current?.(); menuButtonRef.current?.focus(); }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [modern, menuOpen]);
  return (
    <article
      data-feed-post-id={post.id}
      className={`employee-feed-post ${post.pinned ? 'pinned-feed-post' : ''} ${selected ? 'selected' : ''} ${searchCurrent ? 'feed-search-current' : ''}`}
    >
      <header className="employee-feed-post-header vk-feed-post-header">
        <button
          type="button"
          className="feed-avatar profile-link-avatar"
          onClick={(event) => onOpenProfile(authorLogin, event)}
        >
          <AuthenticatedAvatar src={authorAvatar} alt={authorName} fallback={<span>{authorInitial}</span>} />
        </button>
        <button
          type="button"
          className="feed-post-author-block profile-link-name"
          onClick={(event) => onOpenProfile(authorLogin, event)}
        >
          <strong>{post.pinned && <span className="feed-pinned-badge">📌</span>}{authorName}</strong>
          <span>{authorMeta}{post.editedAt && ` · ${t('changed')}`}</span>
        </button>
        <button
          type="button"
          className={`feed-post-select-button ${selected ? 'active' : ''}`}
          aria-pressed={selected}
          aria-label={modern ? t('emoji') : selected ? t('selectedPost') : t('selectPost')}
          title={modern ? t('emoji') : undefined}
          onClick={() => onSelect(post.id)}
        >
          {modern ? <ChatIcon name="smile" size={21} /> : selected ? '✓' : '○'}
        </button>
        <button ref={menuButtonRef} type="button" className="feed-post-menu-button" aria-label={t('dialogActions')} aria-expanded={menuOpen} onClick={() => onToggleMenu(post.id)}>
          {modern ? <ChatIcon name="more" size={22} /> : '⋯'}
        </button>
        {menuOpen && (
          <div className="feed-post-menu" onClick={event => { if (modern && event.target.closest('button')) onCloseMenu?.(); }}>
            {canManage && (
              <button type="button" disabled={mutationPending} onClick={() => onStartEdit(post)}>
                {t('editText')}
              </button>
            )}
            {canPin && (
              <button type="button" disabled={mutationPending} onClick={() => onPin(post.id, !post.pinned)}>
                {post.pinned ? t('unpin') : t('pin')}
              </button>
            )}
            <button type="button" onClick={() => onCopyLink(post.id)}>{t('copyLink')}</button>
            <button type="button" onClick={() => onShare(post)}>{t('sharePost')}</button>
            <button type="button" onClick={() => onQuote(post)}>{t('quotePost')}</button>
            <button type="button" onClick={() => onHide(post.id)}>{t('hidePost')}</button>
            {canManage && (
              <button type="button" className="danger-action" disabled={mutationPending} onClick={() => onDelete(post.id)}>
                {t('delete')}
              </button>
            )}
          </div>
        )}
      </header>

      {editing ? (
        <div className="feed-edit-box">
          <textarea rows={3} value={editingText} onChange={(event) => onEditText(event.target.value)} />
          <div>
            <button type="button" disabled={mutationPending} onClick={() => onSaveEdit(post.id)}>{t('saveActionButton')}</button>
            <button type="button" disabled={mutationPending} onClick={onCancelEdit}>{t('cancel')}</button>
          </div>
        </div>
      ) : post.text && <p className="employee-feed-post-text">{highlightSearchText(post.text)}</p>}

      {attachments.length > 0 && (
        <div className={`employee-feed-media-grid media-count-${Math.min(mediaAttachmentCount, 4)} ${singlePhoto ? 'single-photo' : ''}`}>
          {attachments.map((file, index) => (
            isMediaAttachment(file) ? (
              <MediaCard
                key={file.id || `${post.id}-feed-media-${index}`}
                file={file}
                isEnglish={isEnglish}
                onOpen={() => onOpenMedia(post, file)}
                onQuickReaction={() => {
                  if (!mutationPending) onToggleReaction(post.id, '👍');
                }}
              />
            ) : (
              <AttachmentCard
                key={file.id || `${post.id}-feed-file-${index}`}
                cardKey={`${post.id}-feed-file-${index}`}
                file={file}
                variant="feed"
                isEnglish={isEnglish}
              />
            )
          ))}
        </div>
      )}

      <div className="message-reactions-inline feed-reactions-inline">
        {reactionEmojis.filter((emoji) => (post.reactions?.[emoji] || []).length > 0).map((emoji) => {
          const reactionCount = (post.reactions?.[emoji] || []).length;
          const active = (post.reactions?.[emoji] || []).some((login) => (
            formatLogin(login).toLowerCase() === formatLogin(currentLogin).toLowerCase()
          ));
          return (
            <button
              key={emoji}
              type="button"
              className={active ? 'active' : ''}
              disabled={mutationPending}
              aria-busy={mutationPending}
              aria-pressed={active}
              aria-label={`${emoji} · ${reactionCount}`}
              onClick={() => onToggleReaction(post.id, emoji)}
              title={(post.reactions?.[emoji] || []).join(', ')}
            >
              {emoji}{reactionCount > 1 ? ` ${reactionCount}` : ''}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="feed-selected-menu compact-feed-selected-menu">
          <div className="selected-reaction-row feed-reaction-picker">
            {(reactionExpanded ? reactionEmojis : reactionEmojis.slice(0, 7)).map((emoji) => {
              const active = (post.reactions?.[emoji] || []).some((login) => (
                formatLogin(login).toLowerCase() === formatLogin(currentLogin).toLowerCase()
              ));
              return (
                <button
                  key={emoji}
                  type="button"
                  className={active ? 'active' : ''}
                  disabled={mutationPending}
                  aria-busy={mutationPending}
                  aria-pressed={active}
                  aria-label={emoji}
                  onClick={() => {
                    onToggleReaction(post.id, emoji);
                    onCloseReactionPicker?.();
                  }}
                >
                  {emoji}
                </button>
              );
            })}
            {!reactionExpanded && (
              <button type="button" className="more-reactions" aria-label={isEnglish ? 'More reactions' : 'Другие реакции'} onClick={onExpandReactions}>⌄</button>
            )}
          </div>
          {canPin && (
            <div className="selected-actions-row feed-actions-row">
              <button type="button" disabled={mutationPending} onClick={() => onPin(post.id, !post.pinned)}>
                {post.pinned ? t('unpin') : t('pin')}
              </button>
            </div>
          )}
        </div>
      )}

        <FeedComments
        modern={modern}
        postId={post.id}
        comments={comments}
        totalComments={totalComments}
        hiddenCommentsCount={hiddenCommentsCount}
        expanded={commentsExpanded}
        pending={mutationPending}
        t={t}
        interfaceLocale={interfaceLocale}
        currentLogin={currentLogin}
        currentAvatar={currentAvatar}
        currentName={currentName}
        isManager={isManager}
        isAdmin={isAdmin}
        draft={commentDraft}
        getEmployeeAvatar={getEmployeeAvatar}
        formatLogin={formatLogin}
        onOpenProfile={onOpenProfile}
        onReply={onReplyComment}
        onDelete={onDeleteComment}
        onToggleExpanded={onToggleComments}
        onDraftChange={onCommentDraftChange}
          onSubmit={onSubmitComment}
          highlightText={highlightSearchText}
        />
    </article>
  );
});

export default FeedPostCard;
