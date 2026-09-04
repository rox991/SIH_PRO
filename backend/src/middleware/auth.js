export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
// Replace this development identity with Firebase Admin token verification when credentials are configured.
export function developmentIdentity(req, _res, next) {
  req.user = { uid: req.header('x-demo-user-id') || 'demo-user', role: req.header('x-demo-role') || 'user', email: req.header('x-demo-email') || 'demo@example.invalid' };
  next();
}
