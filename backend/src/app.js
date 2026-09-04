import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { createApiController } from './controllers/apiController.js';
import { ConsentService } from './consent/consentService.js';
import { FhirService } from './fhir/fhirService.js';
import { MockAbdmAdapter } from './integrations/abdm/abdmAdapter.js';
import { FirebaseAdapter } from './integrations/firebase/firebaseAdapter.js';
import { developmentIdentity } from './middleware/auth.js';
import { createApiRouter } from './routes/apiRoutes.js';
import { TerminologyService } from './services/terminologyService.js';

const app = express();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const controller = createApiController({ terminology: new TerminologyService(), fhir: new FhirService(), consent: new ConsentService(), abdm: new MockAbdmAdapter(), firebase: new FirebaseAdapter() });

app.use(express.json({ limit: '32kb' }));
app.use(developmentIdentity);
app.use('/api', createApiRouter(controller));
app.use('/shared', express.static(path.join(rootDir, 'frontend/shared')));
app.use('/patient', express.static(path.join(rootDir, 'frontend/patient')));
app.use('/admin', express.static(path.join(rootDir, 'frontend/admin')));
app.get('/', (_req, res) => res.redirect('/patient/'));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });

if (process.argv[1] === fileURLToPath(import.meta.url)) app.listen(config.port, () => console.log(`AyurFHIR backend listening on http://localhost:${config.port}`));
export default app;
