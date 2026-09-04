import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateConsent, validateMapRequest } from '../middleware/validation.js';

export function createApiRouter(controller, auth, icd) {
  const router = Router();
  router.get('/health', controller.health);

  router.get('/v1/auth/config', auth.clientConfig);
  router.get('/v1/auth/session', auth.session);
  router.post('/v1/auth/register', requireAuth, auth.register);

  router.get('/v1/admin/users', requireRole('admin'), auth.listUsers);
  router.post('/v1/admin/users/:uid/role', requireRole('admin'), auth.setUserRole);
  router.get('/v1/admin/requests', requireRole('admin'), auth.listRequests);

  router.get('/v1/terminology/search', controller.search);

  // ICD-11 browsing is read-only reference data, so it stays open to guests like the demo
  // terminology search above; only writes and admin views sit behind a verified role.
  router.get('/v1/icd11/status', icd.status);
  router.get('/v1/icd11/search', icd.search);
  router.get('/v1/icd11/autocode', icd.autocode);
  router.get('/v1/icd11/chapters', icd.chapters);
  router.get('/v1/icd11/code/:code', icd.codeInfo);
  router.get('/v1/icd11/entity/:id', icd.entity);
  router.post('/v1/terminology/map', validateMapRequest, controller.map);
  router.get('/v1/fhir/sample', controller.sample);
  router.post('/v1/consent', validateConsent, controller.createConsent);
  router.get('/v1/patients/:id/records', controller.patientRecords);
  return router;
}
