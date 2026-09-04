import { config } from '../config/env.js';

function bearerToken(req) {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// Verifies the Firebase ID token sent by the browser and attaches the server-owned profile.
// Roles come from Firestore via the adapter, never from a client-supplied header or claim.
export function createIdentity(firebase) {
  return async (req, _res, next) => {
    req.user = null;
    try {
      const token = bearerToken(req);
      if (token) {
        const decoded = await firebase.verifyIdToken(token);
        if (decoded) {
          const profile = await firebase.ensureProfile({
            uid: decoded.uid,
            email: decoded.email,
            displayName: decoded.name
          });
          req.user = {
            uid: profile.uid,
            email: profile.email,
            name: profile.displayName,
            role: profile.role,
            emailVerified: Boolean(decoded.email_verified)
          };
        }
      }

      // Prototype escape hatch: only when no service account is configured and never in production.
      // It is deliberately capped at the 'user' role — a header can identify a demo caller but
      // must never grant privileges, so admin routes stay unreachable without a verified token.
      if (!req.user && !firebase.isLive && config.environment !== 'production' && req.header('x-demo-user-id')) {
        req.user = {
          uid: req.header('x-demo-user-id'),
          email: req.header('x-demo-email') || 'demo@example.invalid',
          name: 'Demo User',
          role: 'user',
          emailVerified: false,
          isDemoIdentity: true
        };
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
