const fs = require('fs/promises');
const path = require('path');
const db = require('../config/database');

const destination = process.argv[2] || path.join(__dirname, '..', 'data', 'profiles.export.json');

const run = async () => {
  const [rows] = await db.execute('SELECT login, profile_json, updated_at FROM employee_profiles ORDER BY login');
  const profiles = Object.fromEntries(rows.map((row) => [row.login, {
    ...(JSON.parse(row.profile_json || '{}')),
    updatedAt: new Date(row.updated_at).toISOString()
  }]));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, JSON.stringify(profiles, null, 2), 'utf8');
  console.log(`Exported ${rows.length} profiles to ${destination}`);
  await db.end();
};

run().catch(async (error) => { console.error(error); await db.end().catch(() => {}); process.exitCode = 1; });
