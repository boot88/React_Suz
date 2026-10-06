const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createFeedBackupJournal } = require('./feedBackupJournal');

test('reactions append only the changed post and recover before a checkpoint', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feed-journal-'));
  try {
    const journalPath = path.join(dir, 'feed.journal');
    let snapshot = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
    let writes = 0;
    const options = { journalPath, readSnapshot: async () => snapshot, writeSnapshot: async posts => { snapshot = posts; writes += 1; } };
    const store = createFeedBackupJournal(options);
    await store.mutate(posts => posts.map(post => post.id === 'a' ? { ...post, reactions: { '👍': ['alice'] } } : post));
    assert.equal(writes, 0);
    const line = JSON.parse((await fs.readFile(journalPath, 'utf8')).trim());
    assert.deepEqual(line.posts.map(post => post.id), ['a']);
    const recovered = await createFeedBackupJournal(options).read();
    assert.deepEqual(recovered[0].reactions, { '👍': ['alice'] });
    await store.flush();
    assert.equal(writes, 1);
    assert.equal(await fs.readFile(journalPath, 'utf8'), '');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('replacement clears the old recovery log and concurrent changes are serialized', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feed-journal-'));
  try {
    let snapshot = [{ id: 'a', count: 0 }];
    const options = { journalPath: path.join(dir, 'log'), readSnapshot: async () => snapshot, writeSnapshot: async posts => { snapshot = posts; } };
    const store = createFeedBackupJournal(options);
    await Promise.all([1, 2, 3].map(() => store.mutate(posts => posts.map(post => ({ ...post, count: post.count + 1 })))));
    assert.equal((await store.read())[0].count, 3);
    await store.replace([{ id: 'b', count: 0 }]);
    assert.deepEqual(await createFeedBackupJournal(options).read(), [{ id: 'b', count: 0 }]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('backup pause checkpoints pending changes and restore resumes from the restored snapshot', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'feed-maintenance-'));
  try {
    let snapshot = [{ id: 'a', count: 0 }];
    const store = createFeedBackupJournal({ journalPath: path.join(dir, 'nested', 'log'), readSnapshot: async () => snapshot, writeSnapshot: async posts => { snapshot = posts; } });
    await store.read();
    await store.pause();
    snapshot = [{ id: 'restored', count: 1 }];
    await store.resume({ reset: true });
    assert.deepEqual(await store.read(), snapshot);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
