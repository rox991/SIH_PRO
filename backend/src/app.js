import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { createApiController } from './controllers/apiController.js';
import { createAuthController } from './controllers/authController.js';
import { createIcdController } from './controllers/icdController.js';
import { ConsentService } from './consent/consentService.js';
import { FhirService } from './fhir/fhirService.js';
import { MockAbdmAdapter } from './integrations/abdm/abdmAdapter.js';
import { FirebaseAdapter } from './integrations/firebase/firebaseAdapter.js';
import { createIdentity } from './middleware/auth.js';
import { createApiRouter } from './routes/apiRoutes.js';
import { IcdService } from './services/icdService.js';
import { TerminologyService } from './services/terminologyService.js';

const app = express();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const firebase = new FirebaseAdapter();
const controller = createApiController({ terminology: new TerminologyService(), fhir: new FhirService(), consent: new ConsentService(), abdm: new MockAbdmAdapter(), firebase });
const auth = createAuthController({ firebase });
const icdService = new IcdService();
const icd = createIcdController({ icd: icdService });

app.use(express.json({ limit: '32kb' }));
app.use(createIdentity(firebase));
app.use('/api', createApiRouter(controller, auth, icd));
app.use('/shared', express.static(path.join(rootDir, 'frontend/shared')));
app.use('/patient', express.static(path.join(rootDir, 'frontend/patient')));
app.use('/admin', express.static(path.join(rootDir, 'frontend/admin')));
app.get('/', (_req, res) => res.redirect('/patient/'));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(config.port, () => {
    console.log(`AyurFHIR backend listening on http://localhost:${config.port}`);
    if (!config.webConfigured) console.warn('[auth] FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID missing — the browser sign-in forms will stay disabled.');
    if (!config.adminConfigured) console.warn('[auth] FIREBASE_SERVICE_ACCOUNT_* missing — ID tokens are not verified server-side.');
    icdService.status().then((status) => {
      if (status.reachable) console.log(`[icd] ICD-11 API ready at ${config.icd.baseUrl} (release ${status.releaseId}, ${config.icd.linearization}).`);
      else console.warn(`[icd] ICD-11 API not reachable: ${status.error} — the ICD-11 tabs will show an offline notice.`);
    });
  });
}
export default app;
