const API_BASE = '/api';

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { 'Content-Type': 'application/json', ...options.headers }, ...options });
  const payload = await response.json().catch(() => ({ error: 'Invalid API response' }));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const searchTerminology = (q, stream) => api(`/v1/terminology/search?${new URLSearchParams({ q: q || '', stream: stream || 'ALL' })}`);
export const mapTerminology = (payload) => api('/v1/terminology/map', { method: 'POST', body: JSON.stringify(payload) });
export const getFhirSample = (type) => api(`/v1/fhir/sample?type=${encodeURIComponent(type)}`);
