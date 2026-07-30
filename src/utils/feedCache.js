const DATABASE_NAME = 'employee-feed-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'feeds';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_POST_LIMIT = 50;

const createKey = (login) => String(login || 'guest').trim().toLowerCase();

const openDatabase = () => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    resolve(null);
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onerror = () => reject(request.error);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'key' });
    }
  };
  request.onsuccess = () => resolve(request.result);
});

const runTransaction = async (mode, operation) => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = operation(store);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
};

export const readCachedFeed = async (login) => {
  try {
    const key = createKey(login);
    const cached = await runTransaction('readonly', (store) => store.get(key));
    if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL_MS) {
      if (cached) await runTransaction('readwrite', (store) => store.delete(key));
      return null;
    }
    return {
      posts: Array.isArray(cached.posts) ? cached.posts : [],
      before: cached.before || '',
      hasMore: Boolean(cached.hasMore)
    };
  } catch {
    return null;
  }
};

export const writeCachedFeed = async (login, { posts = [], before = '', hasMore = false } = {}) => {
  try {
    const allPosts = Array.isArray(posts) ? posts : [];
    const cachedPosts = allPosts.slice(0, CACHE_POST_LIMIT);
    await runTransaction('readwrite', (store) => store.put({
      key: createKey(login),
      posts: cachedPosts,
      before: cachedPosts[cachedPosts.length - 1]?.createdAt || before,
      hasMore: Boolean(hasMore) || allPosts.length > cachedPosts.length,
      savedAt: Date.now()
    }));
  } catch {
    // IndexedDB can be unavailable or full; the MySQL network path still works.
  }
};
