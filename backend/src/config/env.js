import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Anchor to backend/ so `.env` and relative credential paths resolve the same way whether the
// process is started from the repo root or from the workspace.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true });

// The service account is a server-only secret. It may be supplied either as an inline JSON
// string (convenient for hosted deployments) or as a path to a gitignored file (convenient locally).
function loadServiceAccount() {
  const inline = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const filePath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  const resolvedPath = filePath ? path.resolve(backendRoot, filePath) : '';
  if (resolvedPath && !fs.existsSync(resolvedPath)) {
    console.warn(`[firebase] FIREBASE_SERVICE_ACCOUNT_PATH points at a missing file: ${resolvedPath}`);
    return null;
  }
  const raw = inline || (resolvedPath ? fs.readFileSync(resolvedPath, 'utf8') : '');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Firebase service account is not valid JSON: ${error.message}`);
  }
}

const serviceAccount = loadServiceAccount();

// Only the browser-safe Firebase Web config lives here. These values are public by design —
// Firebase Auth security comes from provider settings, authorized domains, and server-side
// token verification, not from hiding the Web API key.
const webConfig = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || ''
};

export const config = {
  port: Number(process.env.PORT || 3000),
  // The WHO ICD-API container. It serves the classification without OAuth, so the only settings
  // are where it lives and which release/linearization to read. An empty releaseId means
  // "ask the container which release it ships", which survives container upgrades.
  icd: {
    baseUrl: (process.env.ICD_API_BASE_URL || 'http://localhost').trim().replace(/\/+$/, ''),
    releaseId: (process.env.ICD_API_RELEASE_ID || '').trim(),
    linearization: (process.env.ICD_API_LINEARIZATION || 'mms').trim().toLowerCase(),
    language: (process.env.ICD_API_LANGUAGE || 'en').trim(),
    timeoutMs: Number(process.env.ICD_API_TIMEOUT_MS || 10000),
    cacheTtlMs: Number(process.env.ICD_API_CACHE_TTL_MS || 600000)
  },
  environment: process.env.NODE_ENV || 'development',
  serviceAccount,
  webConfig,
  webConfigured: Boolean(webConfig.apiKey && webConfig.authDomain && webConfig.projectId),
  adminConfigured: Boolean(serviceAccount),
  // Emails allowed to become admins on first sign-in. Roles are never accepted from the browser.
  adminBootstrapEmails: (process.env.ADMIN_BOOTSTRAP_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
};
