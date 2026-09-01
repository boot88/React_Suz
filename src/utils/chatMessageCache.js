const DATABASE_NAME = 'employee-chat-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'conversations';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MESSAGE_LIMIT = 50;

const createKey = (login, conversationId) => `${String(login || '').toLowerCase()}::${conversationId}`;

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
    let request;
    try {
      request = operation(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
};

export const readCachedConversation = async (login, conversationId) => {
  try {
    const key = createKey(login, conversationId);
    const cached = await runTransaction('readonly', (store) => store.get(key));
    if (!cached || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL_MS) {
      if (cached) await runTransaction('readwrite', (store) => store.delete(key));
      return [];
    }
    return Array.isArray(cached.messages) ? cached.messages : [];
  } catch {
    return [];
  }
};

export const writeCachedConversation = async (login, conversationId, messages = []) => {
  try {
    const safeMessages = (Array.isArray(messages) ? messages : []).slice(-CACHE_MESSAGE_LIMIT);
    await runTransaction('readwrite', (store) => store.put({
      key: createKey(login, conversationId),
      login: String(login || '').toLowerCase(),
      conversationId,
      messages: safeMessages,
      savedAt: Date.now()
    }));
  } catch {
    // IndexedDB may be disabled or full; the network path remains available.
  }
};

export const removeCachedConversation = async (login, conversationId) => {
  try {
    await runTransaction('readwrite', (store) => store.delete(createKey(login, conversationId)));
  } catch {
    // noop
  }
};

