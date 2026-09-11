import React from 'react';

export default function EmployeeFeedWorkspace({ AttachmentCard, FEED_CATEGORIES, FEED_POSTS_PAGE_SIZE, FeedComposer, FeedMediaCard, FeedPostCard, REACTION_EMOJIS, addCommentToPost, addFeedPost, avatarUrl, canManageFeedPost, chatLocalSettings, commentDrafts, commentSort, copyFeedPostLink, deleteFeedComment, deleteFeedPost, directoryEmployees, editingFeedPostId, editingFeedText, expandedCommentPosts, feedAttachments, feedCategory, feedDraft, feedError, feedHasMore, feedListRef, feedLoading, feedLoadingMore, feedReactionExpanded, feedRefreshing, feedSearch, fetchFeed, formatFeedLogin, formatFileSize, getAttachmentUrl, getEmployeeAvatar, getFeedAttachments, getFeedCategoryLabel, getFileIcon, getOriginalAttachmentUrl, getVideoPosterUrl, hiddenFeedPostsCount, hideFeedPost, interfaceLocale, isAdmin, isEnglishInterface, isFeedPostPending, isImageAttachment, isManager, isMediaAttachment, isPublishingFeed, isVideoAttachment, loadFeedComments, loadMoreFeedPosts, localizeRuntimeText, nudgeVideoToFirstFrame, onFeedFileChange, openEmployeeProfile, openFeedMediaViewer, openFeedMenuId, paginatedRegularFeedPosts, pendingFeedActions, pinnedFeedPosts, profileForm, quoteFeedPost, regularFeedPosts, removeFeedAttachment, sameLogin, saveFeedPostEdit, selectedFeedPostId, setCommentDrafts, setEditingFeedPostId, setEditingFeedText, setExpandedCommentPosts, setFeedCategory, setFeedDraft, setFeedReactionExpanded, setFeedSearch, setMediaViewer, setOpenFeedMenuId, setSelectedFeedPostId, setVisibleFeedPostCount, shareFeedPostToChat, sortComments, startEditFeedPost, t, toggleFeedPinned, toggleFeedReaction, user, visibleFeedPosts }) {
  return (<section className="employee-feed-section">
            <div className="feed-toolbar compact-feed-toolbar sticky-feed-search"><div className="feed-search-shell"><span className="feed-search-icon">🔍</span><input type="search" placeholder={t('searchFeed')} value={feedSearch} onChange={(e) => setFeedSearch(e.target.value)} />{feedSearch && <button type="button" className="feed-search-clear" onClick={() => setFeedSearch('')} aria-label={t('clearSearch')}>×</button>}</div></div>
            <div className="employee-feed-list" ref={feedListRef} onClick={(event) => { if (event.target === event.currentTarget) { setSelectedFeedPostId(''); setFeedReactionExpanded(false); } }}>
              <FeedComposer
                t={t}
                error={feedError ? localizeRuntimeText(feedError) : ''}
                refreshing={feedRefreshing}
                busy={pendingFeedActions.length > 0}
                avatarUrl={avatarUrl}
                currentName={profileForm.full_name || user?.name || user?.username}
                showCategory={chatLocalSettings.showFeedCategorySelect === true}
                category={feedCategory}
                categories={FEED_CATEGORIES}
                getCategoryLabel={getFeedCategoryLabel}
                draft={feedDraft}
                attachments={feedAttachments}
                publishing={isPublishingFeed}
                isVideoAttachment={isVideoAttachment}
                getOriginalAttachmentUrl={getOriginalAttachmentUrl}
                getVideoPosterUrl={getVideoPosterUrl}
                getAttachmentUrl={getAttachmentUrl}
                nudgeVideoToFirstFrame={nudgeVideoToFirstFrame}
                formatFileSize={formatFileSize}
                getFileIcon={getFileIcon}
                onRefresh={() => fetchFeed({ silent: false })}
                onSubmit={addFeedPost}
                onCategoryChange={setFeedCategory}
                onDraftChange={setFeedDraft}
                onOpenAttachment={(file, fileIndex) => setMediaViewer({ source: 'feed-draft', file, fileIndex })}
                onRemoveAttachment={removeFeedAttachment}
                onFileChange={onFeedFileChange}
              />
              {feedLoading && <div className="feed-skeleton-list"><div /><div /><div /></div>}
              {!feedLoading && feedError && <button type="button" className="feed-retry" onClick={() => fetchFeed({ silent: false })}>{t('retryLoad')}</button>}
              {!feedLoading && visibleFeedPosts.length === 0 && <div className="feed-empty-card"><strong>{feedSearch.trim() ? t('noResults') : t('noPosts')}</strong><span>{feedSearch.trim() ? t('tryAnotherSearch') : t('firstPostHint')}</span></div>}
              {pinnedFeedPosts.length > 0 && <div className="feed-pinned-title">📌 {t('pinned')}</div>}
              {[...pinnedFeedPosts, ...paginatedRegularFeedPosts].map((post) => {
                const canDeletePost = canManageFeedPost(post, user, isManager, isAdmin);
                const authorLogin = formatFeedLogin(post.author);
                const authorProfile = directoryEmployees.find((employee) => sameLogin(employee.login, authorLogin)) || {};
                const authorName = post.authorName || authorProfile.full_name || authorLogin || (isEnglishInterface ? 'Employee' : 'Сотрудник');
                const authorMeta = [getFeedCategoryLabel(post.category || 'Объявление'), authorProfile.position || authorProfile.department || (authorLogin ? `@${authorLogin}` : ''), new Date(post.createdAt).toLocaleString(interfaceLocale)].filter(Boolean).join(' · ');
                const authorInitial = String(authorName || authorLogin || '?').slice(0, 1).toUpperCase();
                const authorAvatar = getEmployeeAvatar(authorLogin, post.avatar, post.authorAvatar, post.authorPhoto, post.author_photo, authorProfile.avatar);
                const sortedPostComments = sortComments(post.comments || []);
                const previewComments = expandedCommentPosts[post.id]
                  ? sortedPostComments
                  : (commentSort === 'old' ? sortedPostComments.slice(-2) : sortedPostComments.slice(0, 2));
                const totalPostComments = Math.max(Number(post.commentCount) || 0, sortedPostComments.length);
                const hiddenCommentsCount = Math.max(0, totalPostComments - previewComments.length);
                const postAttachments = getFeedAttachments(post);
                const postMediaAttachments = postAttachments.filter(isMediaAttachment);
                const singlePhotoPost = postMediaAttachments.length === 1 && isImageAttachment(postMediaAttachments[0]);
                const postMutationPending = isFeedPostPending(post.id);
                return (
                  <FeedPostCard
                    key={post.id}
                    post={post}
                    modern={chatLocalSettings.uiDesign === 'modern'}
                    selected={selectedFeedPostId === post.id}
                    menuOpen={openFeedMenuId === post.id}
                    mutationPending={postMutationPending}
                    canManage={canDeletePost}
                    canPin={isManager}
                    authorLogin={authorLogin}
                    authorName={authorName}
                    authorMeta={authorMeta}
                    authorAvatar={authorAvatar}
                    authorInitial={authorInitial}
                    editing={editingFeedPostId === post.id}
                    editingText={editingFeedText}
                    attachments={postAttachments}
                    mediaAttachmentCount={postMediaAttachments.length}
                    singlePhoto={singlePhotoPost}
                    reactionEmojis={REACTION_EMOJIS}
                    reactionExpanded={feedReactionExpanded}
                    comments={previewComments}
                    totalComments={totalPostComments}
                    hiddenCommentsCount={hiddenCommentsCount}
                    commentsExpanded={Boolean(expandedCommentPosts[post.id])}
                    commentDraft={commentDrafts[post.id] || ''}
                    currentLogin={user?.username || ''}
                    currentAvatar={avatarUrl}
                    currentName={profileForm.full_name || user?.name || user?.username}
                    isManager={isManager}
                    isAdmin={isAdmin}
                    isEnglish={isEnglishInterface}
                    interfaceLocale={interfaceLocale}
                    t={t}
                    getEmployeeAvatar={getEmployeeAvatar}
                    formatLogin={formatFeedLogin}
                    isMediaAttachment={isMediaAttachment}
                    MediaCard={FeedMediaCard}
                    AttachmentCard={AttachmentCard}
                    onOpenProfile={openEmployeeProfile}
                    onCloseMenu={() => setOpenFeedMenuId('')}
                    onToggleMenu={(postId) => setOpenFeedMenuId((current) => (current === postId ? '' : postId))}
                    onStartEdit={startEditFeedPost}
                    onEditText={setEditingFeedText}
                    onSaveEdit={saveFeedPostEdit}
                    onCancelEdit={() => setEditingFeedPostId('')}
                    onPin={toggleFeedPinned}
                    onCopyLink={copyFeedPostLink}
                    onShare={shareFeedPostToChat}
                    onQuote={quoteFeedPost}
                    onHide={hideFeedPost}
                    onDelete={deleteFeedPost}
                    onOpenMedia={openFeedMediaViewer}
                    onToggleReaction={toggleFeedReaction}
                    onSelect={(postId) => {
                      if (selectedFeedPostId === postId && feedReactionExpanded) {
                        setFeedReactionExpanded(false);
                        return;
                      }
                      setSelectedFeedPostId((current) => (current === postId ? '' : postId));
                      setFeedReactionExpanded(false);
                    }}
                    onExpandReactions={() => setFeedReactionExpanded(true)}
                    onReplyComment={(postId, author) => setCommentDrafts((current) => ({
                      ...current,
                      [postId]: `@${formatFeedLogin(author)} ${current[postId] || ''}`,
                    }))}
                    onDeleteComment={deleteFeedComment}
                    onToggleComments={(postId, expanded) => {
                      if (expanded) {
                        if (hiddenCommentsCount > 0) loadFeedComments(postId, { append: true });
                        else setExpandedCommentPosts((current) => ({ ...current, [postId]: false }));
                        return;
                      }
                      loadFeedComments(postId);
                    }}
                    onCommentDraftChange={(postId, value) => setCommentDrafts((current) => ({
                      ...current,
                      [postId]: value,
                    }))}
                    onSubmitComment={addCommentToPost}
                  />
                );
              })}
              {(hiddenFeedPostsCount > 0 || feedHasMore) && <button type="button" className="chat-pagination-button feed-pagination-button" disabled={feedLoadingMore || pendingFeedActions.length > 0} onClick={() => { if (hiddenFeedPostsCount > 0) setVisibleFeedPostCount((prev) => prev + FEED_POSTS_PAGE_SIZE); else loadMoreFeedPosts(); }}>{feedLoadingMore ? t('loading') : t('loadMoreFeed')} · {paginatedRegularFeedPosts.length}/{regularFeedPosts.length}{feedHasMore ? '+' : ''}</button>}
            </div>
          </section>);
}
