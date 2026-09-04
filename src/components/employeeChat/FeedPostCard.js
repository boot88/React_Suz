import React, { memo } from 'react';
import FeedComments from './FeedComments';
import AuthenticatedAvatar from './AuthenticatedAvatar';

const FeedPostCard = memo(function FeedPostCard({
  post,
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
  onSelect,
  onExpandReactions,
  onReplyComment,
  onDeleteComment,
  onToggleComments,
  onCommentDraftChange,
  onSubmitComment
}) {
  return (
    <article
      className={`employee-feed-post ${post.pinned ? 'pinned-feed-post' : ''} ${selected ? 'selected' : ''}`}
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
          aria-label={selected ? t('selectedPost') : t('selectPost')}
          onClick={() => onSelect(post.id)}
        >
          {selected ? '✓' : '○'}
        </button>
        <button type="button" className="feed-post-menu-button" onClick={() => onToggleMenu(post.id)}>
          ⋯
        </button>
        {menuOpen && (
          <div className="feed-post-menu">
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
      ) : post.text && <p className="employee-feed-post-text">{post.text}</p>}

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
          const active = (post.reactions?.[emoji] || []).includes(currentLogin);
          return (
            <button
              key={emoji}
              type="button"
              className={active ? 'active' : ''}
              disabled={mutationPending}
              aria-busy={mutationPending}
              onClick={() => onToggleReaction(post.id, emoji)}
              title={(post.reactions?.[emoji] || []).join(', ')}
            >
              {emoji} {(post.reactions?.[emoji] || []).length}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="feed-selected-menu compact-feed-selected-menu">
          <div className="selected-reaction-row feed-reaction-picker">
            {(reactionExpanded ? reactionEmojis : reactionEmojis.slice(0, 7)).map((emoji) => {
              const active = (post.reactions?.[emoji] || []).includes(currentLogin);
              return (
                <button
                  key={emoji}
                  type="button"
                  className={active ? 'active' : ''}
                  disabled={mutationPending}
                  aria-busy={mutationPending}
                  onClick={() => onToggleReaction(post.id, emoji)}
                >
                  {emoji}
                </button>
              );
            })}
            {!reactionExpanded && (
              <button type="button" className="more-reactions" onClick={onExpandReactions}>⌄</button>
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
      />
    </article>
  );
});

export default FeedPostCard;
