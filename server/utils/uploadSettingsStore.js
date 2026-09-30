const db = require('../config/database');
const { createUploadSettingsStore } = require('./uploadSettings');
module.exports = createUploadSettingsStore(db);
