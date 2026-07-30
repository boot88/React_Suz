const getFeedTimestamp = (post = {}) => {
  return Math.max(0, ...[post.createdAt, post.updatedAt, post.deletedAt, post.editedAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite));
};

const createSerialMutationQueue = ({ read, write }) => {
  let queue = Promise.resolve();

  const enqueue = (operation) => {
    const run = queue
      .catch(() => {})
      .then(operation);
    queue = run;
    return run;
  };

  return {
    replace(posts, validate) {
      return enqueue(async () => {
        const current = await read();
        if (validate) validate(posts, current);
        await write(posts);
        return posts;
      });
    },
    mutate(mutator) {
      return enqueue(async () => {
        const current = await read();
        const next = await mutator(current);
        await write(next);
        return next;
      });
    }
  };
};

const setReactionState = (post = {}, emoji, login, active) => {
  const reactions = { ...(post.reactions || {}) };
  const users = new Set(Array.isArray(reactions[emoji]) ? reactions[emoji] : []);
  if (active) users.add(login);
  else users.delete(login);
  if (users.size) reactions[emoji] = [...users];
  else delete reactions[emoji];
  return { ...post, reactions };
};

const toSafeSqlLimit = (value, fallback = 50, maximum = 100) => (
  Math.min(maximum, Math.max(1, Number(value) || fallback))
);

const buildFeedPostsPageQuery = ({ limit = 50, before = '' } = {}) => {
  const safeLimit = toSafeSqlLimit(limit);
  const params = [];
  let where = 'deleted_at IS NULL';
  if (before) {
    where += ' AND created_at < ?';
    params.push(new Date(before));
  }
  return {
    sql: `SELECT post_json FROM feed_posts WHERE ${where} ORDER BY pinned DESC, created_at DESC LIMIT ${safeLimit}`,
    params
  };
};

const buildFeedCommentsPageQuery = (postId, { limit = 50, before = '' } = {}) => {
  const safeLimit = toSafeSqlLimit(limit);
  const params = [postId];
  let where = 'post_id = ? AND deleted_at IS NULL';
  if (before) {
    where += ' AND created_at < ?';
    params.push(new Date(before));
  }
  return {
    sql: `SELECT comment_json FROM feed_comments WHERE ${where} ORDER BY created_at DESC LIMIT ${safeLimit}`,
    params
  };
};

const buildFeedCommentPreviewsQuery = (postIds = [], limit = 3) => {
  const safeIds = postIds.filter(Boolean);
  const safeLimit = toSafeSqlLimit(limit, 3, 5);
  const placeholders = safeIds.map(() => '?').join(',');
  return {
    sql: `SELECT post_id, comment_json
      FROM (
        SELECT post_id, comment_json, created_at,
          ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY created_at DESC) AS row_number
        FROM feed_comments
        WHERE deleted_at IS NULL AND post_id IN (${placeholders})
      ) AS ranked_comments
      WHERE row_number <= ${safeLimit}
      ORDER BY post_id, created_at ASC`,
    params: safeIds
  };
};

const mergeFeedPosts = (archivePosts = [], sqlPosts = [], limit = 50) => {
  const byId = new Map();

  [...sqlPosts, ...archivePosts].forEach((post) => {
    if (!post?.id) return;
    const current = byId.get(post.id);
    if (!current || getFeedTimestamp(post) >= getFeedTimestamp(current)) {
      byId.set(post.id, post);
    }
  });

  return [...byId.values()]
    .filter((post) => !post.deletedAt)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || getFeedTimestamp(b) - getFeedTimestamp(a))
    .slice(0, limit);
};

const mergeFeedComments = (archiveComments = [], sqlComments = [], limit = 50) => {
  const byId = new Map();

  [...sqlComments, ...archiveComments].forEach((comment) => {
    if (!comment?.id) return;
    const current = byId.get(comment.id);
    if (!current || getFeedTimestamp(comment) >= getFeedTimestamp(current)) {
      byId.set(comment.id, comment);
    }
  });

  return [...byId.values()]
    .filter((comment) => !comment.deletedAt)
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    .slice(-limit);
};

module.exports = {
  buildFeedCommentPreviewsQuery,
  buildFeedCommentsPageQuery,
  buildFeedPostsPageQuery,
  createSerialMutationQueue,
  getFeedTimestamp,
  mergeFeedComments,
  mergeFeedPosts,
  setReactionState
};
