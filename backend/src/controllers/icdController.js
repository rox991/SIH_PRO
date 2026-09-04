import { IcdApiError } from '../integrations/icd/icdAdapter.js';
import { IcdService } from '../services/icdService.js';

// Every ICD-11 handler shares the same failure mode: the upstream container is down, the release
// does not contain the entity, or the query was rejected. IcdApiError carries the right status,
// and anything else is a genuine bug that belongs in the app-level error handler.
function handle(fn) {
  return async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      if (error instanceof IcdApiError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
}

function queryOptions(req) {
  return {
    release: req.query.release,
    linearization: req.query.linearization,
    chapterFilter: req.query.chapter,
    flexible: req.query.flexible === 'true',
    includeKeywords: req.query.keywords === 'true'
  };
}

export function createIcdController({ icd = new IcdService() } = {}) {
  return {
    status: handle(() => icd.status()),
    search: handle((req) => icd.search(req.query.q, queryOptions(req))),
    chapters: handle((req) => icd.chapters(queryOptions(req))),
    entity: handle((req) => icd.entity(req.params.id, queryOptions(req))),
    codeInfo: handle((req) => icd.codeInfo(req.params.code, queryOptions(req))),
    autocode: handle((req) => icd.autocode(req.query.q, queryOptions(req)))
  };
}
