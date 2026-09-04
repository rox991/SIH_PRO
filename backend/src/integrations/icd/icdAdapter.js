import { config } from '../../config/env.js';

// Thin HTTP client for a WHO ICD-API deployment (the licensed container normally run at
// http://localhost/). The container serves the classification unauthenticated, so unlike the
// hosted icd.who.int API there is no OAuth2 step here — only the version/language headers.
export class IcdApiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'IcdApiError';
    this.status = status;
  }
}

// Responses are large and completely static for a given release, so a short-lived in-memory
// cache keeps repeated browsing (chapter drill-down re-reads the same parents) off the wire.
class TtlCache {
  constructor(ttlMs, maxEntries) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key, value) {
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

export class IcdAdapter {
  constructor(options = {}) {
    const settings = { ...config.icd, ...options };
    this.baseUrl = String(settings.baseUrl || '').replace(/\/+$/, '');
    this.linearization = settings.linearization;
    this.language = settings.language;
    this.releaseId = settings.releaseId || '';
    this.timeoutMs = settings.timeoutMs;
    this.cache = new TtlCache(settings.cacheTtlMs, 500);
    this.rootPromise = null;
  }

  get isConfigured() {
    return Boolean(this.baseUrl);
  }

  async request(path, { searchParams } = {}) {
    if (!this.isConfigured) throw new IcdApiError('ICD-11 API base URL is not configured.', 503);

    const url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(searchParams || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    let response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', 'API-Version': 'v2', 'Accept-Language': this.language },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const reason = error.name === 'TimeoutError' ? `timed out after ${this.timeoutMs}ms` : error.message;
      throw new IcdApiError(`ICD-11 API at ${this.baseUrl} is unreachable (${reason}).`, 503);
    }

    if (response.status === 404) throw new IcdApiError('The requested ICD-11 entity does not exist in this release.', 404);
    if (!response.ok) throw new IcdApiError(`ICD-11 API responded with HTTP ${response.status}.`, 502);

    const payload = await response.json().catch(() => {
      throw new IcdApiError('ICD-11 API returned a response that is not JSON.', 502);
    });
    this.cache.set(cacheKey, payload);
    return payload;
  }

  // GET /icd/entity is the only endpoint that needs no release id, so it is what we use to learn
  // which release the container actually ships — hard-coding one breaks on every container update.
  async root() {
    if (!this.rootPromise) {
      this.rootPromise = this.request('icd/entity').catch((error) => {
        this.rootPromise = null;
        throw error;
      });
    }
    return this.rootPromise;
  }

  async resolveRelease(requested) {
    if (requested) return requested;
    if (this.releaseId) return this.releaseId;
    const root = await this.root();
    if (!root.releaseId) throw new IcdApiError('ICD-11 API did not report a release id.', 502);
    return root.releaseId;
  }

  resolveLinearization(requested) {
    const name = String(requested || this.linearization).toLowerCase();
    // Path segment goes into a URL unescaped, so only accept the short linearization names.
    if (!/^[a-z0-9-]{1,20}$/.test(name)) throw new IcdApiError('Unsupported linearization name.', 400);
    return name;
  }

  async info() {
    const root = await this.root();
    const releaseId = await this.resolveRelease();
    return {
      releaseId,
      releaseDate: root.releaseDate || '',
      title: root.title?.['@value'] || '',
      availableLanguages: root.availableLanguages || [],
      linearizations: (root.includedLinearizations || []).map((uri) => uri.split('/').pop())
    };
  }

  async search(query, { release, linearization, chapterFilter, flexible, includeKeywords } = {}) {
    const releaseId = await this.resolveRelease(release);
    const name = this.resolveLinearization(linearization);
    return this.request(`icd/release/11/${releaseId}/${name}/search`, {
      searchParams: {
        q: query,
        chapterFilter,
        useFlexisearch: flexible ? 'true' : 'false',
        includeKeywordResult: includeKeywords ? 'true' : 'false',
        flatResults: 'true',
        medicalCodingMode: 'true'
      }
    });
  }

  async entity(id, { release, linearization } = {}) {
    const releaseId = await this.resolveRelease(release);
    const name = this.resolveLinearization(linearization);
    if (!/^\d{1,20}$/.test(String(id))) throw new IcdApiError('ICD-11 entity id must be numeric.', 400);
    return this.request(`icd/release/11/${releaseId}/${name}/${id}`);
  }

  async chapters({ release, linearization } = {}) {
    const releaseId = await this.resolveRelease(release);
    const name = this.resolveLinearization(linearization);
    return this.request(`icd/release/11/${releaseId}/${name}`);
  }

  async codeInfo(code, { release, linearization } = {}) {
    const releaseId = await this.resolveRelease(release);
    const name = this.resolveLinearization(linearization);
    return this.request(`icd/release/11/${releaseId}/${name}/codeinfo/${encodeURIComponent(code)}`);
  }

  async autocode(text, { release, linearization } = {}) {
    const releaseId = await this.resolveRelease(release);
    const name = this.resolveLinearization(linearization);
    return this.request(`icd/release/11/${releaseId}/${name}/autocode`, { searchParams: { searchText: text } });
  }
}
