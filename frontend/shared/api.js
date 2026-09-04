import { getIdToken } from './firebase-auth.js';

const API_BASE = '/api';

export async function api(path, options = {}) {
  const token = await getIdToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({ error: 'Invalid API response' }));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const searchTerminology = (q, stream) => api(`/v1/terminology/search?${new URLSearchParams({ q: q || '', stream: stream || 'ALL' })}`);
export const mapTerminology = (payload) => api('/v1/terminology/map', { method: 'POST', body: JSON.stringify(payload) });
export const getFhirSample = (type) => api(`/v1/fhir/sample?type=${encodeURIComponent(type)}`);
// WHO ICD-11 API (served by the backend, which proxies the local icd-api container).
const icdQuery = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false));
export const icdStatus = () => api('/v1/icd11/status');
export const icdSearch = (q, options = {}) => api(`/v1/icd11/search?${icdQuery({ q, chapter: options.chapter, flexible: options.flexible, keywords: options.keywords })}`);
export const icdChapters = () => api('/v1/icd11/chapters');
export const icdEntity = (id) => api(`/v1/icd11/entity/${encodeURIComponent(id)}`);
export const icdCodeInfo = (code) => api(`/v1/icd11/code/${encodeURIComponent(code)}`);
export const icdAutocode = (q) => api(`/v1/icd11/autocode?${icdQuery({ q })}`);

export const listAdminUsers = () => api('/v1/admin/users');
export const listAdminRequests = () => api('/v1/admin/requests');
export const setUserRole = (uid, role) => api(`/v1/admin/users/${encodeURIComponent(uid)}/role`, { method: 'POST', body: JSON.stringify({ role }) });
