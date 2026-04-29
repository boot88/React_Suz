const CACHE_RULES = [
  {
    key: 'instantCache:chatThreads',
    match: (url, method) => method === 'GET' && url.includes('/chat/threads') && !url.includes('/stream'),
    ttl: 60 * 60 * 1000
  },
  {
    key: 'instantCache:applications',
    match: (url, method) => method === 'GET' && url.includes('/applications') && !url.includes('/export'),
    ttl: 10 * 60 * 1000
  }
];

const now = () => Date.now();

const readCache = (key, ttl) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.body || !parsed.savedAt) return null;
    if (ttl && now() - parsed.savedAt > ttl) return null;
    return parsed.body;
  } catch {
    return null;
  }
};

const writeCache = (key, body) => {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: now(), body }));
  } catch {
    // localStorage may be full or blocked
  }
};

const createJsonResponse = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'X-Instant-Cache': 'hit'
  }
});

export const setupInstantDataCache = () => {
  if (window.__instantDataCacheReady) return;
  window.__instantDataCacheReady = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const request = args[0];
    const options = args[1] || {};
    const url = typeof request === 'string' ? request : request?.url || '';
    const method = String(options.method || request?.method || 'GET').toUpperCase();
    const rule = CACHE_RULES.find((item) => item.match(url, method));

    if (!rule) {
      return nativeFetch(...args);
    }

    const cachedBody = readCache(rule.key, rule.ttl);

    if (cachedBody) {
      nativeFetch(...args)
        .then((response) => response.ok ? response.clone().json() : null)
        .then((body) => {
          if (body) writeCache(rule.key, body);
        })
        .catch(() => {});

      return createJsonResponse(cachedBody);
    }

    const response = await nativeFetch(...args);
    if (response.ok) {
      response.clone().json()
        .then((body) => writeCache(rule.key, body))
        .catch(() => {});
    }

    return response;
  };

  try {
    const stream = new EventSource('/api/chat/threads/stream');
    stream.addEventListener('threads', (event) => {
      try {
        writeCache('instantCache:chatThreads', JSON.parse(event.data));
      } catch {
        // ignore malformed stream payloads
      }
    });
  } catch {
    // SSE is optional; polling/fetch fallback continues working
  }
};
