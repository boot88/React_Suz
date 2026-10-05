const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const createCredentialStore = (file) => {
  let queue = Promise.resolve();
  const update = (operation) => {
    const task = queue.then(async () => {
      const previous = await fs.readFile(file, 'utf8').then(JSON.parse).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
      const entries = operation(previous);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      if (!entries.length) { await fs.rm(file, { force: true }); return entries; }
      const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
      try {
        await fs.writeFile(temporary, JSON.stringify(entries, null, 2), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
      return entries;
    });
    queue = task.catch(() => {});
    return task;
  };
  return { update };
};
const provisioningCredentials = createCredentialStore(path.join(__dirname, '../data/initial-admin-credentials.json'));
module.exports = { provisioningCredentials, createCredentialStore };
