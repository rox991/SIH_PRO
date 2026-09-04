import { config } from '../config/env.js';

export function createAuthController({ firebase }) {
  return {
    // Browser-safe Firebase Web config. Serving it from the backend keeps the keys in .env
    // instead of hardcoded in two HTML files that drift apart.
    clientConfig: (_req, res) => res.json({
      configured: config.webConfigured,
      tokenVerification: firebase.isLive,
      firebase: config.webConfig
    }),

    session: (req, res) => res.json({
      authenticated: Boolean(req.user),
      tokenVerification: firebase.isLive,
      user: req.user
    }),

    // Called right after a client-side createUserWithEmailAndPassword so the display name
    // lands on the server-owned profile. The role in the request body is deliberately ignored.
    register: async (req, res, next) => {
      try {
        const displayName = String(req.body?.displayName || '').trim().slice(0, 120);
        const profile = await firebase.ensureProfile({
          uid: req.user.uid,
          email: req.user.email,
          displayName: displayName || req.user.name
        });
        res.status(201).json({ user: { uid: profile.uid, email: profile.email, name: profile.displayName, role: profile.role } });
      } catch (error) { next(error); }
    },

    listUsers: async (_req, res, next) => {
      try {
        res.json({ users: await firebase.listProfiles() });
      } catch (error) { next(error); }
    },

    setUserRole: async (req, res, next) => {
      try {
        const role = String(req.body?.role || '');
        if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'role must be "user" or "admin".' });
        if (req.params.uid === req.user.uid) return res.status(400).json({ error: 'You cannot change your own role.' });
        const profile = await firebase.setRole(req.params.uid, role);
        if (!profile) return res.status(404).json({ error: 'User not found.' });
        res.json({ user: profile });
      } catch (error) { next(error); }
    },

    listRequests: async (_req, res, next) => {
      try {
        res.json({ requests: await firebase.listMappingRequests(200) });
      } catch (error) { next(error); }
    }
  };
}
