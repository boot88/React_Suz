// Deleted requests must not return through an older fetch or stream update.
const mergeEmployeeApplications = (current = [], incoming = [], deleted = new Set(), replace = false) => {
  const known = new Map(current.map(item => [String(item.id), item]));
  const next = new Map();
  for (const item of incoming) {
    const key = String(item.id);
    if (deleted.has(key) || item.deleted_at) continue;
    const old = known.get(key);
    next.set(key, old && Number(old.revision || 0) > Number(item.revision || 0) ? old : item);
  }
  if (!replace) for (const [key, item] of known) if (!next.has(key) && !deleted.has(key) && !item.deleted_at) next.set(key, item);
  return [...next.values()];
};
module.exports = { mergeEmployeeApplications };
