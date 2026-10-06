export const createAvatarCache = (maxItems = 64, maxBytes = 8 * 1024 * 1024) => {
  const items = new Map();
  let bytes = 0, generation = 0;
  const remove = key => { const item = items.get(key); if (item) bytes -= item.bytes; items.delete(key); };
  return {
    get generation() { return generation; },
    get size() { return items.size; },
    get bytes() { return bytes; },
    get(key) { const item = items.get(key); if (!item) return undefined; items.delete(key); items.set(key, item); return item.value; },
    set(key, value, epoch = generation) {
      if (epoch !== generation) return;
      const size = typeof value === 'string' ? value.length * 2 : 0;
      if (size > maxBytes) return;
      const path = key.split('?')[0];
      [...items.keys()].filter(existing => existing !== key && existing.split('?')[0] === path).forEach(remove);
      remove(key); items.set(key, { value, bytes: size }); bytes += size;
      while (items.size > maxItems || bytes > maxBytes) remove(items.keys().next().value);
    },
    delete: remove,
    clear() { items.clear(); bytes = 0; generation += 1; }
  };
};
export const avatarCache = createAvatarCache();
if (typeof window !== 'undefined') window.addEventListener('auth:avatar-cache-clear', () => avatarCache.clear());
