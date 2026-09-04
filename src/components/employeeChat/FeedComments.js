import React, { memo } from 'react';
import AuthenticatedAvatar from './AuthenticatedAvatar';

const FeedComments = memo(function FeedComments({
  postId,
  comments,
  totalComments,
  hiddenCommentsCount,
  expanded,
  pending,
  t,
  interfaceLocale,
  currentLogin,
  currentAvatar,
  currentName,
  isManager,
  isAdmin,
  draft,
  getEmployeeAvatar,
  formatLogin,
  onOpenProfile,
  onReply,
  onDelete,
  onToggleExpanded,
  onDraftChange,
  onSubmit
}) {
  return (
    <div className="employee-feed-comments">
      <div className="employee-feed-comments-title">{t('comments')} · {totalComments}</div>
      {comments.length === 0 && <small className="employee-feed-no-comments">{t('noComments')}</small>}
      {comments.map((comment) => {
        const canDelete = isManager || isAdmin || comment.author === currentLogin;
        const commentInitial = String(comment.authorName || comment.author || '?').slice(0, 1).toUpperCase();
        const commentAvatar = getEmployeeAvatar(
          comment.author,
          comment.avatar,
          comment.authorAvatar,
          comment.authorPhoto,
          comment.author_photo
        );
        return (
          <div key={comment.id} className="employee-feed-comment">
            <button
              type="button"
              className="feed-avatar comment-avatar profile-link-avatar"
              onClick={(event) => onOpenProfile(comment.author, event)}
            >
              <AuthenticatedAvatar
                src={commentAvatar}
                alt={comment.authorName || comment.author || t('comments')}
                loading="lazy"
                decoding="async"
                fallback={<span>{commentInitial}</span>}
              />
            </button>
            <div className="employee-feed-comment-body">
              <button
                type="button"
                className="comment-author-link"
                onClick={(event) => onOpenProfile(comment.author, event)}
              >
                {comment.authorName || formatLogin(comment.author)}
              </button>
              <span>{comment.text}</span>
              <small>{new Date(comment.createdAt).toLocaleString(interfaceLocale)}</small>
              <div className="feed-comment-actions compact">
                <button type="button" onClick={() => onReply(postId, comment.author)}>{t('reply')}</button>
                {canDelete && (
                  <button
                    type="button"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => onDelete(postId, comment.id)}
                  >
                    {t('delete')}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {(hiddenCommentsCount > 0 || (expanded && totalComments > 2)) && (
        <button
          type="button"
          className="feed-show-more-comments"
          disabled={pending}
          onClick={() => onToggleExpanded(postId, expanded)}
        >
          {expanded ? t('hideComments') : t('showAllComments')} ({totalComments})
        </button>
      )}
      <div className="employee-feed-comment-form">
        <div className="feed-avatar comment-avatar feed-avatar-current">
          <AuthenticatedAvatar
            src={currentAvatar}
            alt={t('myAvatar')}
            loading="lazy"
            decoding="async"
            fallback={<span>{String(currentName || '?').slice(0, 1).toUpperCase()}</span>}
          />
        </div>
        <input
          placeholder={t('writeComment')}
          value={draft}
          disabled={pending}
          onChange={(event) => onDraftChange(postId, event.target.value)}
        />
        {draft.trim() && (
          <button type="button" disabled={pending} onClick={() => onSubmit(postId)}>
            {t('sendComment')}
          </button>
        )}
      </div>
    </div>
  );
});

export default FeedComments;
