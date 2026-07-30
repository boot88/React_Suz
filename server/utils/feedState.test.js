const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFeedCommentPreviewsQuery,
  buildFeedCommentsPageQuery,
  buildFeedPostsPageQuery,
  createSerialMutationQueue,
  mergeFeedComments,
  mergeFeedPosts,
  setReactionState
} = require('./feedState');

const clone = (value) => JSON.parse(JSON.stringify(value));

test('feed page queries inline validated limits for MySQL 8.4', () => {
  const posts = buildFeedPostsPageQuery({ limit: '25', before: '2026-07-23T10:00:00.000Z' });
  const comments = buildFeedCommentsPageQuery('post-1', { limit: 500 });

  assert.match(posts.sql, /LIMIT 25$/);
  assert.equal(posts.sql.includes('LIMIT ?'), false);
  assert.equal(posts.params.length, 1);
  assert.match(comments.sql, /LIMIT 100$/);
  assert.equal(comments.params.length, 1);
});

test('comment previews use one window query for all posts', () => {
  const query = buildFeedCommentPreviewsQuery(['post-1', 'post-2'], 3);

  assert.match(query.sql, /ROW_NUMBER\(\) OVER \(PARTITION BY post_id/);
  assert.match(query.sql, /post_id IN \(\?,\?\)/);
  assert.match(query.sql, /row_number <= 3/);
  assert.deepEqual(query.params, ['post-1', 'post-2']);
});

test('serial mutations preserve a reaction and an attachment deletion made together', async () => {
  let stored = [{
    id: 'post-1',
    attachments: [{ id: 'photo-1' }],
    reactions: {},
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z'
  }];
  const queue = createSerialMutationQueue({
    read: async () => clone(stored),
    write: async (posts) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      stored = clone(posts);
    }
  });

  await Promise.all([
    queue.mutate((posts) => posts.map((post) => (
      post.id === 'post-1'
        ? { ...setReactionState(post, '👍', 'ivanov', true), updatedAt: '2026-07-23T10:00:01.000Z' }
        : post
    ))),
    queue.mutate((posts) => posts.map((post) => (
      post.id === 'post-1'
        ? { ...post, attachments: [], attachment: null, updatedAt: '2026-07-23T10:00:02.000Z' }
        : post
    )))
  ]);

  assert.deepEqual(stored[0].attachments, []);
  assert.deepEqual(stored[0].reactions, { '👍': ['ivanov'] });
});

test('an archive tombstone suppresses an older SQL copy', () => {
  const merged = mergeFeedPosts(
    [{
      id: 'post-1',
      deletedAt: '2026-07-23T10:00:02.000Z'
    }],
    [{
      id: 'post-1',
      text: 'stale SQL copy',
      updatedAt: '2026-07-23T10:00:01.000Z'
    }]
  );

  assert.deepEqual(merged, []);
});

test('setting the same reaction state twice is idempotent', () => {
  const first = setReactionState({ reactions: {} }, '👍', 'ivanov', true);
  const second = setReactionState(first, '👍', 'ivanov', true);
  const removed = setReactionState(second, '👍', 'ivanov', false);

  assert.deepEqual(second.reactions, { '👍': ['ivanov'] });
  assert.deepEqual(removed.reactions, {});
});

test('archive comments augment SQL and tombstones suppress stale SQL comments', () => {
  const comments = mergeFeedComments(
    [
      { id: 'comment-1', deletedAt: '2026-07-23T10:00:03.000Z' },
      { id: 'comment-2', text: 'JSON-only comment', createdAt: '2026-07-23T10:00:02.000Z' }
    ],
    [
      { id: 'comment-1', text: 'stale SQL comment', createdAt: '2026-07-23T10:00:01.000Z' }
    ]
  );

  assert.deepEqual(comments.map((comment) => comment.id), ['comment-2']);
});

test('a failed write does not poison later feed mutations', async () => {
  let stored = [{ id: 'post-1', text: 'before' }];
  let shouldFail = true;
  const queue = createSerialMutationQueue({
    read: async () => clone(stored),
    write: async (posts) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('temporary write failure');
      }
      stored = clone(posts);
    }
  });

  await assert.rejects(
    queue.mutate((posts) => posts.map((post) => ({ ...post, text: 'failed change' }))),
    /temporary write failure/
  );
  await queue.mutate((posts) => posts.map((post) => ({ ...post, text: 'recovered' })));

  assert.equal(stored[0].text, 'recovered');
});
