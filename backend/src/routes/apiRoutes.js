import { Router } from 'express';
import { validateConsent, validateMapRequest } from '../middleware/validation.js';

export function createApiRouter(controller) {
  const router = Router();
  router.get('/health', controller.health);
  router.get('/v1/terminology/search', controller.search);
  router.post('/v1/terminology/map', validateMapRequest, controller.map);
  router.get('/v1/fhir/sample', controller.sample);
  router.post('/v1/consent', validateConsent, controller.createConsent);
  router.get('/v1/patients/:id/records', controller.patientRecords);
  return router;
}
