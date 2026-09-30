const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const settings = require('../utils/uploadSettingsStore');
const { MIN_UPLOAD_MB, MAX_UPLOAD_MB } = require('../utils/uploadSettings');
const router = express.Router();
router.use(requireAuth);
router.get('/chat-upload-limit', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ limitMb: await settings.getLimitMb(), minMb: MIN_UPLOAD_MB, maxMb: MAX_UPLOAD_MB });
  } catch { res.status(503).json({ message: 'Не удалось загрузить лимит вложений. Повторите попытку.' }); }
});
router.put('/chat-upload-limit', requireRole('admin'), async (req, res) => {
  try { res.json({ limitMb: await settings.saveLimitMb(req.body?.limitMb), minMb: MIN_UPLOAD_MB, maxMb: MAX_UPLOAD_MB }); }
  catch (error) { res.status(error.status || 503).json({ message: error.status === 400 ? error.message : 'Не удалось сохранить лимит вложений. Повторите попытку.' }); }
});
module.exports = router;
