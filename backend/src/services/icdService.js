import { IcdAdapter, IcdApiError } from '../integrations/icd/icdAdapter.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// Search titles arrive with the API's own <em class='found'> match markers embedded. Rather than
// trusting that markup, everything is escaped first and only those two known markers are turned
// back into tags, so nothing the classification data contains can inject HTML into the portals.
function highlighted(value) {
  return escapeHtml(value)
    .replace(/&lt;em class=&#39;found&#39;&gt;/g, '<mark>')
    .replace(/&lt;\/em&gt;/g, '</mark>');
}

function plain(value) {
  return String(value ?? '').replace(/<em class='found'>/g, '').replace(/<\/em>/g, '');
}

function text(node) {
  if (!node) return '';
  if (typeof node === 'string') return plain(node);
  return plain(node['@value'] || '');
}

function idFromUri(uri) {
  const match = /\/(\d+)(?:\/[a-z]+)?$/.exec(String(uri || ''));
  return match ? match[1] : '';
}

function labelList(items) {
  return (items || []).map((item) => ({
    label: text(item.label),
    entityId: idFromUri(item.linearizationReference || item.foundationReference)
  })).filter((item) => item.label);
}

export class IcdService {
  constructor({ adapter = new IcdAdapter() } = {}) {
    this.adapter = adapter;
  }

  get isConfigured() {
    return this.adapter.isConfigured;
  }

  async status() {
    if (!this.isConfigured) return { configured: false, reachable: false, error: 'ICD_API_BASE_URL is not set.' };
    try {
      const info = await this.adapter.info();
      return { configured: true, reachable: true, linearization: this.adapter.linearization, language: this.adapter.language, ...info };
    } catch (error) {
      return { configured: true, reachable: false, error: error.message };
    }
  }

  async search(query, options = {}) {
    const q = String(query || '').trim();
    if (q.length < 2) throw new IcdApiError('Provide at least 2 characters to search ICD-11.', 400);

    const payload = await this.adapter.search(q, options);
    if (payload.error) throw new IcdApiError(payload.errorMessage || 'ICD-11 search failed.', 502);

    const results = (payload.destinationEntities || []).map((entity) => ({
      entityId: idFromUri(entity.stemId || entity.id),
      code: entity.theCode || '',
      title: plain(entity.title),
      titleHtml: highlighted(entity.title),
      chapter: entity.chapter || '',
      score: typeof entity.score === 'number' ? Number(entity.score.toFixed(4)) : null,
      isLeaf: Boolean(entity.isLeaf),
      isResidual: Boolean(entity.isResidualOther || entity.isResidualUnspecified),
      matchedTerms: (entity.matchingPVs || [])
        .filter((pv) => pv.propertyId !== 'Title')
        .slice(0, 6)
        .map((pv) => ({ property: pv.propertyId, label: plain(pv.label), important: Boolean(pv.important) })),
      uri: entity.stemId || entity.id || ''
    }));

    return { source: 'icd-api', query: q, count: results.length, truncated: Boolean(payload.resultChopped), results };
  }

  // Parents and children come back as bare URIs. Resolving their titles is what makes the detail
  // panel navigable, and the adapter cache means a drill-down costs one round trip per new entity.
  async #resolveTitles(uris, options, limit) {
    const list = (uris || []).slice(0, limit).map(idFromUri).filter(Boolean);
    const settled = await Promise.allSettled(list.map((id) => this.adapter.entity(id, options)));
    return settled
      .map((outcome, index) => (outcome.status === 'fulfilled'
        ? { entityId: list[index], code: outcome.value.code || '', title: text(outcome.value.title), classKind: outcome.value.classKind || '' }
        : null))
      .filter(Boolean);
  }

  async entity(id, options = {}) {
    const entity = await this.adapter.entity(id, options);
    const [parents, children] = await Promise.all([
      this.#resolveTitles(entity.parent, options, 5),
      this.#resolveTitles(entity.child, options, 60)
    ]);

    return {
      source: 'icd-api',
      entity: {
        entityId: idFromUri(entity['@id']),
        code: entity.code || '',
        title: text(entity.title),
        classKind: entity.classKind || '',
        definition: text(entity.definition),
        longDefinition: text(entity.longDefinition),
        fullySpecifiedName: text(entity.fullySpecifiedName),
        codingNote: text(entity.codingNote),
        inclusions: labelList(entity.inclusion),
        exclusions: labelList(entity.exclusion),
        indexTerms: (entity.indexTerm || []).map((term) => text(term.label)).filter(Boolean).slice(0, 40),
        synonyms: (entity.synonym || []).map((term) => text(term.label)).filter(Boolean).slice(0, 40),
        postcoordination: (entity.postcoordinationScale || []).map((scale) => ({
          axis: String(scale.axisName || '').split('/').pop(),
          required: scale.requiredPostcoordination === 'true',
          allowMultiple: scale.allowMultipleValues || ''
        })),
        browserUrl: entity.browserUrl || '',
        foundationUri: entity.source || '',
        childCount: (entity.child || []).length,
        parents,
        children
      }
    };
  }

  async chapters(options = {}) {
    const root = await this.adapter.chapters(options);
    return {
      source: 'icd-api',
      releaseId: root.releaseId || '',
      title: text(root.title),
      chapters: await this.#resolveTitles(root.child, options, 40)
    };
  }

  async codeInfo(code, options = {}) {
    const raw = String(code || '').trim();
    if (!raw) throw new IcdApiError('A code is required.', 400);
    const info = await this.adapter.codeInfo(raw, options);
    const entityId = idFromUri(info.stemId);
    if (!entityId) throw new IcdApiError(`No ICD-11 entity is coded as "${raw}".`, 404);
    const detail = await this.entity(entityId, options);
    return { ...detail, code: info.code || raw };
  }

  // Best-match coding for a free-text clinical phrase — the bridge NAMASTE terms need to reach
  // an ICD-11 code when no curated mapping exists yet.
  async autocode(term, options = {}) {
    const searchText = String(term || '').trim();
    if (searchText.length < 2) throw new IcdApiError('Provide at least 2 characters to autocode.', 400);
    const match = await this.adapter.autocode(searchText, options);
    if (!match || !match.theCode) return { source: 'icd-api', searchText, match: null };
    return {
      source: 'icd-api',
      searchText,
      match: {
        code: match.theCode,
        matchedText: match.matchingText || '',
        entityId: idFromUri(match.linearizationURI || match.foundationURI),
        matchScore: typeof match.matchScore === 'number' ? Number(match.matchScore.toFixed(4)) : null,
        matchLevel: match.matchLevel ?? null,
        isTitleMatch: Boolean(match.isTitle)
      }
    };
  }
}
