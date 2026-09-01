const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const db = require('../config/database');

const archivePath = process.argv[2] || path.join(__dirname, '..', 'data', 'profiles.json');
const avatarDir = path.join(__dirname, '..', 'uploads', 'profile');
const mimeToExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const decodeAvatar = (value) => {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  return data.length && data.length <= 1024 * 1024 ? { mime: match[1].toLowerCase(), data } : null;
};

const run = async () => {
  const archive = JSON.parse(await fs.readFile(archivePath, 'utf8'));
  await fs.mkdir(avatarDir, { recursive: true });
  let count = 0;
  for (const [rawLogin, rawProfile] of Object.entries(archive || {})) {
    const login = String(rawLogin).trim().toLowerCase();
    const profile = rawProfile && typeof rawProfile === 'object' ? { ...rawProfile } : {};
    const avatar = decodeAvatar(profile.avatar);
    delete profile.avatar;
    const updatedAt = new Date(profile.updatedAt || Date.now());
    profile.updatedAt = updatedAt.toISOString();
    let storedName = null;
    if (avatar) {
      storedName = `${login.replace(/[^a-z0-9_-]/gi, '_')}-${Date.now()}-${crypto.randomUUID()}.${mimeToExtension[avatar.mime]}`;
      await fs.writeFile(path.join(avatarDir, storedName), avatar.data, { flag: 'wx' });
      count += 1;
    }
    await db.execute(
      `INSERT INTO employee_profiles (login, profile_json, avatar_stored_name, avatar_mime, avatar_size, avatar_updated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE profile_json = VALUES(profile_json), avatar_stored_name = COALESCE(VALUES(avatar_stored_name), avatar_stored_name), avatar_mime = COALESCE(VALUES(avatar_mime), avatar_mime), avatar_size = COALESCE(VALUES(avatar_size), avatar_size), avatar_updated_at = COALESCE(VALUES(avatar_updated_at), avatar_updated_at), updated_at = VALUES(updated_at)`,
      [login, JSON.stringify(profile), storedName, avatar?.mime || null, avatar?.data.length || null, avatar ? updatedAt : null, updatedAt]
    );
  }
  console.log(`Migrated ${count} avatar files from ${archivePath}`);
  await db.end();
};

run().catch(async (error) => { console.error(error); await db.end().catch(() => {}); process.exitCode = 1; });
