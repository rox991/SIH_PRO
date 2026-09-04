import { icdAutocode, icdChapters, icdCodeInfo, icdEntity, icdSearch, icdStatus } from './api.js';

// One ICD-11 browser shared by the patient and admin portals. It renders its own markup into an
// empty container so both pages only need a nav button and a placeholder section, and so the two
// stay in sync when the classification UI changes.

const state = { root: null, status: null, chapters: [], results: [], selected: null, mode: 'idle', query: '' };
let searchTimer = null;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id)?.classList.toggle('hidden', !visible);

function setPanel(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function spinner(label) {
  return `<div class="flex items-center gap-2 text-xs text-slate-500 p-6"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>${esc(label)}</div>`;
}

function errorBox(message) {
  return `<div class="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">${esc(message)}</div>`;
}

function emptyBox(message) {
  return `<div class="p-8 text-center text-xs text-slate-500">${esc(message)}</div>`;
}

function codeChip(code, classKind) {
  if (code) return `<span class="shrink-0 px-2 py-0.5 bg-teal-600 text-white font-mono font-bold text-[11px] rounded">${esc(code)}</span>`;
  return `<span class="shrink-0 px-2 py-0.5 bg-slate-200 text-slate-600 font-mono text-[10px] rounded uppercase">${esc(classKind || 'group')}</span>`;
}

function template() {
  return `
  <div class="space-y-5">
    <!-- Search bar -->
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
      <div class="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 class="font-bold text-slate-900 text-base flex items-center gap-2">
            <span class="material-symbols-outlined text-teal-600 text-xl">coronavirus</span>
            WHO ICD-11 Disease Search
          </h3>
          <p class="text-[11px] text-slate-500 mt-0.5">Live lookup against the WHO ICD-API — every disease, code, definition, inclusion and exclusion.</p>
        </div>
        <span id="icd-status-pill" class="px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">Connecting…</span>
      </div>

      <div class="relative">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</span>
        <input id="icd-search-input" type="text" autocomplete="off" placeholder="Search a disease, symptom or ICD-11 code (e.g. asthma, diabetes, 5A11, malaria)…"
          class="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:border-teal-600 transition-all" />
      </div>

      <div class="flex items-center gap-4 flex-wrap text-xs">
        <label class="flex items-center gap-1.5 text-slate-600">
          <span class="font-medium">Chapter</span>
          <select id="icd-chapter-filter" class="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 font-medium max-w-[16rem]">
            <option value="">All chapters</option>
          </select>
        </label>
        <label class="flex items-center gap-1.5 text-slate-600 cursor-pointer">
          <input id="icd-flexible" type="checkbox" class="rounded border-slate-300 text-teal-600 focus:ring-teal-600" />
          <span class="font-medium">Flexible search</span>
        </label>
        <button id="icd-autocode-btn" class="ml-auto px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg flex items-center gap-1 transition-colors">
          <span class="material-symbols-outlined text-sm">bolt</span> Best-match code
        </button>
      </div>

      <div id="icd-autocode-result" class="hidden"></div>
    </div>

    <!-- Results + detail -->
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-5">
      <div class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
        <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <span id="icd-results-title" class="text-xs font-bold text-slate-700">Chapters</span>
          <span class="text-[11px] text-slate-500"><strong id="icd-results-count" class="text-slate-900">0</strong> entries</span>
        </div>
        <div id="icd-results" class="divide-y divide-slate-100 overflow-y-auto max-h-[34rem]"></div>
      </div>

      <div class="lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div id="icd-detail" class="overflow-y-auto max-h-[38rem]"></div>
      </div>
    </div>
  </div>`;
}

function renderStatus() {
  const pill = $('icd-status-pill');
  if (!pill) return;
  const status = state.status;
  if (status?.reachable) {
    pill.className = 'px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800';
    pill.innerText = `ICD-11 ${status.linearization.toUpperCase()} · release ${status.releaseId}`;
    pill.title = `${status.title} — released ${status.releaseDate}`;
  } else {
    pill.className = 'px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800';
    pill.innerText = 'ICD-11 API offline';
    pill.title = status?.error || 'The ICD-API container is not reachable.';
  }
}

function renderResults() {
  const { mode, results } = state;
  $('icd-results-count').innerText = results.length;
  $('icd-results-title').innerText = mode === 'search' ? `Results for “${state.query}”` : mode === 'children' ? 'Sub-categories' : 'ICD-11 chapters';

  if (!results.length) {
    setPanel('icd-results', emptyBox(mode === 'search' ? 'No ICD-11 entity matches this search.' : 'Nothing to list here.'));
    return;
  }

  setPanel('icd-results', results.map((item) => `
    <button type="button" data-icd-entity="${esc(item.entityId)}"
      class="w-full text-left px-4 py-3 hover:bg-teal-50/60 transition-colors ${state.selected === item.entityId ? 'bg-teal-50' : ''}">
      <div class="flex items-start gap-2">
        ${codeChip(item.code, item.classKind)}
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-slate-900 leading-snug">${item.titleHtml || esc(item.title)}</p>
          ${item.matchedTerms?.length ? `<p class="text-[10px] text-slate-500 mt-1 truncate">also: ${esc(item.matchedTerms.map((t) => t.label).join(' · '))}</p>` : ''}
          <div class="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
            ${item.chapter ? `<span>Ch. ${esc(item.chapter)}</span>` : ''}
            ${item.isLeaf === false ? '<span>has sub-categories</span>' : ''}
            ${item.isResidual ? '<span class="text-amber-600">residual</span>' : ''}
          </div>
        </div>
      </div>
    </button>`).join(''));
}

function labelSection(title, items, tone) {
  if (!items?.length) return '';
  return `<div>
    <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">${esc(title)}</h4>
    <ul class="space-y-1">${items.map((item) => `
      <li class="text-xs ${tone}">${item.entityId
        ? `<button type="button" data-icd-entity="${esc(item.entityId)}" class="text-left hover:underline">${esc(item.label)}</button>`
        : esc(item.label)}</li>`).join('')}</ul>
  </div>`;
}

function chipSection(title, values) {
  if (!values?.length) return '';
  return `<div>
    <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">${esc(title)}</h4>
    <div class="flex flex-wrap gap-1.5">${values.map((value) => `<span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px]">${esc(value)}</span>`).join('')}</div>
  </div>`;
}

function renderDetail(entity) {
  const crumbs = entity.parents.map((parent) =>
    `<button type="button" data-icd-entity="${esc(parent.entityId)}" class="hover:text-teal-700 hover:underline">${esc(parent.title)}</button>`).join(' <span class="text-slate-300">/</span> ');

  setPanel('icd-detail', `
    <div class="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
      ${crumbs ? `<p class="text-[11px] text-slate-400 mb-1.5 flex flex-wrap gap-1 items-center">${crumbs}</p>` : ''}
      <div class="flex items-start gap-3">
        ${entity.code
          ? `<span class="px-2.5 py-1 bg-teal-500 text-slate-950 font-mono font-extrabold text-sm rounded">${esc(entity.code)}</span>`
          : `<span class="px-2.5 py-1 bg-white/10 text-white font-mono text-[11px] rounded uppercase">${esc(entity.classKind)}</span>`}
        <div class="min-w-0">
          <h3 class="font-bold text-base leading-snug">${esc(entity.title)}</h3>
          ${entity.fullySpecifiedName ? `<p class="text-[11px] text-slate-400 mt-1">${esc(entity.fullySpecifiedName)}</p>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-3 mt-3 text-[11px]">
        <span class="px-2 py-0.5 bg-white/10 rounded">${esc(entity.classKind || 'entity')}</span>
        <span class="px-2 py-0.5 bg-white/10 rounded font-mono">ID ${esc(entity.entityId)}</span>
        ${entity.browserUrl ? `<a href="${esc(entity.browserUrl)}" target="_blank" rel="noopener noreferrer" class="ml-auto text-teal-300 hover:underline flex items-center gap-1">WHO browser <span class="material-symbols-outlined text-xs">open_in_new</span></a>` : ''}
      </div>
    </div>

    <div class="p-5 space-y-5">
      ${entity.definition ? `<p class="text-xs text-slate-700 leading-relaxed">${esc(entity.definition)}</p>` : '<p class="text-xs text-slate-400 italic">This entity has no definition in this release.</p>'}
      ${entity.codingNote ? `<div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800"><strong>Coding note:</strong> ${esc(entity.codingNote)}</div>` : ''}

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        ${labelSection('Inclusions', entity.inclusions, 'text-slate-700')}
        ${labelSection('Exclusions', entity.exclusions, 'text-red-700')}
      </div>

      ${chipSection('Synonyms', entity.synonyms)}
      ${chipSection('Index terms', entity.indexTerms)}

      ${entity.postcoordination?.length ? `<div>
        <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Postcoordination axes</h4>
        <div class="flex flex-wrap gap-1.5">${entity.postcoordination.map((axis) =>
          `<span class="px-2 py-0.5 rounded text-[11px] ${axis.required ? 'bg-teal-100 text-teal-800 font-semibold' : 'bg-slate-100 text-slate-600'}">${esc(axis.axis)}${axis.required ? ' (required)' : ''}</span>`).join('')}</div>
      </div>` : ''}

      ${entity.children.length ? `<div>
        <div class="flex items-center justify-between mb-1.5">
          <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sub-categories (${entity.childCount})</h4>
          <button type="button" id="icd-browse-children" class="text-[11px] text-teal-600 font-semibold hover:underline">Browse in list →</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">${entity.children.slice(0, 12).map((child) => `
          <button type="button" data-icd-entity="${esc(child.entityId)}" class="text-left px-2.5 py-1.5 bg-slate-50 hover:bg-teal-50 border border-slate-200 rounded-lg text-[11px] flex items-center gap-2">
            ${codeChip(child.code, child.classKind)}<span class="truncate text-slate-700">${esc(child.title)}</span>
          </button>`).join('')}</div>
      </div>` : ''}
    </div>`);

  $('icd-browse-children')?.addEventListener('click', () => {
    state.mode = 'children';
    state.results = entity.children.map((child) => ({ ...child, isLeaf: undefined }));
    renderResults();
  });
}

async function openEntity(entityId) {
  state.selected = entityId;
  renderResults();
  setPanel('icd-detail', spinner('Loading ICD-11 entity…'));
  try {
    const { entity } = await icdEntity(entityId);
    renderDetail(entity);
  } catch (error) {
    setPanel('icd-detail', errorBox(error.message));
  }
}

// A bare ICD-11 code (5A11, CA23.32) is looked up directly; anything else is a text search.
const looksLikeCode = (value) => /^[0-9][A-Z][A-Z0-9]{1,2}(\.[A-Z0-9]{1,3})?$/i.test(value.trim());

async function runSearch() {
  const query = $('icd-search-input').value.trim();
  state.query = query;

  if (query.length < 2) {
    await loadChapters();
    return;
  }

  setPanel('icd-results', spinner('Searching ICD-11…'));

  if (looksLikeCode(query)) {
    try {
      const { entity } = await icdCodeInfo(query);
      state.mode = 'search';
      state.results = [{ entityId: entity.entityId, code: entity.code, title: entity.title, classKind: entity.classKind }];
      renderResults();
      await openEntity(entity.entityId);
      return;
    } catch {
      // Not a known code — fall through to a normal text search.
    }
  }

  try {
    const payload = await icdSearch(query, {
      chapter: $('icd-chapter-filter').value,
      flexible: $('icd-flexible').checked
    });
    state.mode = 'search';
    state.results = payload.results;
    renderResults();
    if (payload.results.length) await openEntity(payload.results[0].entityId);
    else setPanel('icd-detail', emptyBox('Select a result to see its full ICD-11 record.'));
  } catch (error) {
    state.results = [];
    setPanel('icd-results', errorBox(error.message));
  }
}

async function runAutocode() {
  const query = $('icd-search-input').value.trim();
  const box = $('icd-autocode-result');
  if (query.length < 2) {
    box.className = 'text-[11px] text-amber-700';
    box.innerText = 'Type a clinical phrase first, then ask for its best-match code.';
    return;
  }

  box.className = 'text-xs text-slate-500';
  box.innerText = 'Coding…';
  try {
    const { match } = await icdAutocode(query);
    if (!match) {
      box.className = 'text-[11px] text-amber-700 font-medium';
      box.innerText = `No ICD-11 code could be assigned to “${query}”.`;
      return;
    }
    box.className = 'p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs flex items-center gap-3 flex-wrap';
    box.innerHTML = `
      <span class="px-2 py-0.5 bg-teal-600 text-white font-mono font-bold text-[11px] rounded">${esc(match.code)}</span>
      <span class="text-slate-800 font-semibold">${esc(match.matchedText)}</span>
      <span class="text-[11px] text-slate-500">score ${esc(match.matchScore)} · level ${esc(match.matchLevel)}</span>
      <button type="button" data-icd-entity="${esc(match.entityId)}" class="ml-auto text-teal-700 font-semibold hover:underline">Open record →</button>`;
  } catch (error) {
    box.className = 'text-[11px] text-red-600 font-medium';
    box.innerText = error.message;
  }
}

async function loadChapters() {
  state.mode = 'chapters';
  if (state.chapters.length) {
    state.results = state.chapters;
    renderResults();
    return;
  }
  setPanel('icd-results', spinner('Loading ICD-11 chapters…'));
  try {
    const { chapters } = await icdChapters();
    state.chapters = chapters;
    state.results = chapters;
    renderResults();
    const filter = $('icd-chapter-filter');
    filter.innerHTML = '<option value="">All chapters</option>' +
      chapters.filter((chapter) => chapter.code).map((chapter) => `<option value="${esc(chapter.code)}">${esc(chapter.code)} — ${esc(chapter.title)}</option>`).join('');
  } catch (error) {
    state.results = [];
    setPanel('icd-results', errorBox(error.message));
  }
}

export async function mountIcdExplorer(containerId) {
  const container = document.getElementById(containerId);
  if (!container || state.root === container) return;
  state.root = container;
  container.innerHTML = template();

  $('icd-search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 300);
  });
  $('icd-chapter-filter').addEventListener('change', runSearch);
  $('icd-flexible').addEventListener('change', runSearch);
  $('icd-autocode-btn').addEventListener('click', runAutocode);

  // One delegated handler covers every entity link — result rows, breadcrumbs, exclusions,
  // sub-category chips — including the ones rendered later.
  container.addEventListener('click', (event) => {
    const target = event.target.closest('[data-icd-entity]');
    if (target) openEntity(target.dataset.icdEntity);
  });

  setPanel('icd-detail', emptyBox('Search for a disease, or pick a chapter to start browsing ICD-11.'));

  state.status = await icdStatus().catch((error) => ({ reachable: false, error: error.message }));
  renderStatus();
  if (state.status.reachable) await loadChapters();
  else setPanel('icd-results', errorBox(state.status.error || 'The ICD-11 API is not reachable from this server.'));
}

window.mountIcdExplorer = mountIcdExplorer;
