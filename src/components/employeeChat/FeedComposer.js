import React, { memo } from 'react';
import AuthenticatedAvatar from './AuthenticatedAvatar';

const FeedComposer = memo(function FeedComposer({
  t,
  error,
  refreshing,
  busy,
  avatarUrl,
  currentName,
  showCategory,
  category,
  categories,
  getCategoryLabel,
  draft,
  attachments,
  publishing,
  isVideoAttachment,
  getOriginalAttachmentUrl,
  getVideoPosterUrl,
  getAttachmentUrl,
  nudgeVideoToFirstFrame,
  formatFileSize,
  getFileIcon,
  onRefresh,
  onSubmit,
  onCategoryChange,
  onDraftChange,
  onOpenAttachment,
  onRemoveAttachment,
  onFileChange
}) {
  return (
    <article className="employee-feed-post feed-composer-post">
      <header className="employee-feed-header compact-feed-header feed-composer-post-header">
        <div><h2>{t('feedTitle')}</h2><p>{t('feedSubtitle')}</p></div>
        <button type="button" disabled={refreshing || busy} onClick={onRefresh}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </header>
      {error && <div className="feed-status-warning">{t('feedUnavailable')}: {error}</div>}
      <form className="employee-feed-composer compact-feed-composer vk-feed-composer" onSubmit={onSubmit}>
        <div className="feed-composer-body">
          <div className="feed-avatar feed-avatar-current">
            <AuthenticatedAvatar
              src={avatarUrl}
              alt={t('myAvatar')}
              loading="lazy"
              decoding="async"
              fallback={<span>{String(currentName || '?').slice(0, 1).toUpperCase()}</span>}
            />
          </div>
          <div className={`feed-composer-line ${showCategory ? 'has-category' : 'without-category'}`}>
            {showCategory && (
              <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
                {categories.map((item) => (
                  <option key={item} value={item}>{getCategoryLabel(item)}</option>
                ))}
              </select>
            )}
            <textarea
              rows={2}
              placeholder={t('whatsNew')}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
          </div>
        </div>
        {attachments.length > 0 && (
          <div className="employee-feed-attachment-preview-grid media-draft-grid">
            {attachments.map((file, index) => {
              const mediaFile = String(file.type || '').startsWith('image/') || isVideoAttachment(file);
              const fileKey = file.id || `${file.name}-${index}`;
              return (
                <div key={fileKey} className={`employee-feed-attachment-preview media-draft-tile ${mediaFile ? 'is-media' : ''}`}>
                  {mediaFile ? (
                    <button type="button" className="media-draft-thumb" onClick={() => onOpenAttachment(file, index)}>
                      {isVideoAttachment(file)
                        ? (
                          <video
                            src={getOriginalAttachmentUrl(file)}
                            poster={getVideoPosterUrl(file) || getAttachmentUrl(file)}
                            muted
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={nudgeVideoToFirstFrame}
                          />
                        )
                        : <img src={getAttachmentUrl(file)} alt={file.name} loading="lazy" decoding="async" />}
                    </button>
                  ) : <span className="media-draft-file-icon">{getFileIcon(file.type)}</span>}
                  <span>{file.name} · {formatFileSize(file.size)}</span>
                  <button type="button" className="media-draft-remove" onClick={() => onRemoveAttachment(fileKey)}>×</button>
                </div>
              );
            })}
          </div>
        )}
        <div className="employee-feed-composer-actions">
          <label>
            📎 {t('photoVideo')}
            <input
              type="file"
              multiple
              hidden
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar,.7z"
              onChange={onFileChange}
            />
          </label>
          <button type="submit" disabled={publishing || (!draft.trim() && attachments.length === 0)}>
            {publishing ? t('publishing') : t('publish')}
          </button>
        </div>
      </form>
    </article>
  );
});

export default FeedComposer;
