const fs = require('fs/promises');
const path = require('path');

// SQL remains authoritative. The recovery copy records only changed posts on
// each mutation, and checkpoints the full JSON at most once per minute.
const createFeedBackupJournal = ({ readSnapshot, writeSnapshot, journalPath, intervalMs = 60000, onError = console.warn }) => {
  let posts;
  let queue = Promise.resolve();
  let timer;
  let paused = false;
  const enqueue = operation => {
    const run = queue.catch(() => {}).then(operation);
    queue = run;
    return run;
  };
  const load = async () => {
    if (posts) return posts;
    const initial = await readSnapshot();
    const byId = new Map(initial.map(post => [post.id, post]));
    let journal = '';
    try { journal = await fs.readFile(journalPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lines = journal.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index]) continue;
      let record;
      try { record = JSON.parse(lines[index]); } catch (error) {
        // Only a torn final append is recoverable. Never silently skip a
        // damaged record in the middle of a recovery log.
        if (index !== lines.length - 1) throw error;
        await fs.writeFile(journalPath, lines.slice(0, index).join('\n') + (index ? '\n' : ''), 'utf8');
        break;
      }
      (record.removed || []).forEach(id => byId.delete(id));
      (record.posts || []).forEach(post => byId.set(post.id, post));
    }
    posts = [...byId.values()];
    return posts;
  };
  const checkpoint = async () => {
    await fs.mkdir(path.dirname(journalPath), { recursive: true });
    await writeSnapshot(await load());
    await fs.writeFile(journalPath, '', 'utf8');
  };
  const schedule = () => {
    if (timer || paused) return;
    timer = setTimeout(() => { timer = null; enqueue(checkpoint).catch(onError); }, intervalMs);
    timer.unref?.();
  };
  return {
    read: () => enqueue(load),
    mutate: mutator => enqueue(async () => {
      const current = await load();
      const next = await mutator(current);
      const byId = new Map(current.map(post => [post.id, post]));
      const ids = new Set(next.map(post => post.id));
      const changed = next.filter(post => byId.get(post.id) !== post);
      const removed = current.filter(post => !ids.has(post.id)).map(post => post.id);
      if (changed.length || removed.length) {
        await fs.mkdir(path.dirname(journalPath), { recursive: true });
        await fs.appendFile(journalPath, `${JSON.stringify({ posts: changed, removed })}\n`, 'utf8');
        posts = next;
        schedule();
      }
      return next;
    }),
    replace: (next, validate) => enqueue(async () => {
      const current = await load();
      validate?.(next, current);
      await fs.mkdir(path.dirname(journalPath), { recursive: true });
      await writeSnapshot(next);
      await fs.writeFile(journalPath, '', 'utf8');
      posts = next;
      return next;
    }),
    flush: () => enqueue(checkpoint),
    pause: () => {
      paused = true;
      clearTimeout(timer); timer = null;
      return enqueue(async () => { if (posts) await checkpoint(); });
    },
    resume: ({ reset = false } = {}) => enqueue(async () => {
      if (reset) posts = undefined;
      paused = false;
    })
  };
};
module.exports = { createFeedBackupJournal };
