const fs = require('fs/promises');
const path = require('path');
const db = require('../config/database');

const source = process.argv[2] || path.join(__dirname, '..', 'data', 'profiles.json');

const run = async () => {
  const parsed = JSON.parse(await fs.readFile(source, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Profile archive must be an object');
  let count = 0;
  for (const [login, value] of Object.entries(parsed)) {
    const profile = value && typeof value === 'object' ? { ...value } : {};
    delete profile.avatar;
    const updatedAt = new Date(profile.updatedAt || Date.now());
    profile.updatedAt = updatedAt.toISOString();
    await db.execute(
      `INSERT INTO employee_profiles (login, profile_json, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE profile_json = VALUES(profile_json), updated_at = VALUES(updated_at)`,
      [String(login).trim().toLowerCase(), JSON.stringify(profile), updatedAt]
    );
    count += 1;
  }
  console.log(`Restored ${count} profiles from ${source}. Run migrate:profile-avatars separately for archived Base64 avatars.`);
  await db.end();
};

run().catch(async (error) => { console.error(error); await db.end().catch(() => {}); process.exitCode = 1; });
