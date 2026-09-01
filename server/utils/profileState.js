const getProfileTimestamp = (profile = {}) => {
  const timestamp = new Date(profile.updatedAt || profile.updated_at || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const mergeProfileMaps = (archiveProfiles = {}, sqlProfiles = {}) => {
  const logins = new Set([
    ...Object.keys(archiveProfiles || {}),
    ...Object.keys(sqlProfiles || {})
  ]);
  const merged = {};

  logins.forEach((login) => {
    const archive = archiveProfiles?.[login];
    const sql = sqlProfiles?.[login];
    if (!archive) {
      merged[login] = sql;
      return;
    }
    if (!sql) {
      merged[login] = archive;
      return;
    }
    merged[login] = getProfileTimestamp(archive) > getProfileTimestamp(sql)
      ? archive
      : sql;
  });

  return merged;
};

const getRequestValue = (body = {}, key, fallback = '') => (
  Object.prototype.hasOwnProperty.call(body, key) ? body[key] : fallback
);

module.exports = {
  getProfileTimestamp,
  getRequestValue,
  mergeProfileMaps
};
