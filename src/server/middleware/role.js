module.exports = function requireRole(role) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ message: 'Требуется аутентификация' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ message: 'Доступ запрещен' });
    }
    next();
  };
};
