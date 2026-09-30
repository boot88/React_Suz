const express = require('express');
const { validateBroadcast } = require('../utils/chatBroadcasts');

module.exports = ({ store, prepare, actor, ready }) => {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(async (req, res, next) => {
    try { await ready(); next(); }
    catch { res.status(503).json({ message: 'Хранилище чата временно недоступно' }); }
  });
  const respond = (action) => async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Не удалось выполнить рассылку. Обновите историю и повторите попытку.' }); }
  };
  router.get('/recipients', respond(() => store.recipients()));
  router.get('/', respond((req) => store.list(req.auth.login, req.query.offset)));
  router.post('/', respond(async (req) => {
    validateBroadcast({ ...req.body, attachments: req.body?.attachments || [] });
    const attachments = await prepare(req);
    return store.create({ ...req.body, attachments }, await actor(req));
  }));
  router.get('/:id', respond((req) => store.detail(req.params.id, req.auth.login)));
  router.post('/:id/retry', respond((req) => store.send(req.params.id, req.auth.login)));
  return router;
};
