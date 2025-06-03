module.exports = function (req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'employee')) {
    return next();
  }
  return res.status(403).json({ message: 'Access denied.' });
}; 