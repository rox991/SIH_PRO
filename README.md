# AyurFHIR Bridge — Node.js refactor

This experimental branch converts the original two-page Firebase prototype into a frontend plus Express backend structure.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`. The Express process serves:

- `/patient/` — practitioner portal
- `/admin/` — administration UI
- `/api/health` — backend health endpoint

## API

- `GET /api/health`
- `GET /api/v1/terminology/search?q=Amlapitta&stream=Ayurveda`
- `POST /api/v1/terminology/map`
- `GET /api/v1/fhir/sample?type=condition`
- `POST /api/v1/consent`
- `GET /api/v1/patients/:id/records` (requires an active mock consent and `x-hospital-id`)

Mapping input requires `emrPatientId`, `ayushSystem`, `legacyTerm`, `namasteCode`, and an optional supported `outputFormat`.

## Architecture

`backend/src` owns API routes, input validation, terminology mapping, FHIR construction, consent, and integration boundaries. Demo NAMASTE/ICD-11 mappings and ABDM records are explicitly mock data. They are isolated so official providers can replace them later.

`frontend/shared/api.js` is the frontend API client. The patient portal's terminology search and mapping sandbox now call Express rather than browser-side RTDB writes. Firebase Auth remains loaded as a transitional client authentication dependency, but the Realtime Database SDK has been removed from the served pages.

`backend/src/integrations/firebase/firebaseAdapter.js` is the server-side Firebase boundary. It currently uses an in-memory development implementation; add Firebase Admin SDK initialization using a server-only service account to connect a real Firebase project. Do not expose that credential to the browser.

## Security and prototype limits

- Public self-service admin registration and browser-side role modification are disabled in the migrated flow.
- The admin UI is intentionally held behind a server-managed-access message until Firebase Admin token verification and admin API routes are configured.
- Development identity headers exist only to make the prototype API testable; they are not authentication and must be replaced before deployment.
- Consent and ABDM use in-memory mock adapters. No ABHA/Aadhaar lookup is implemented.
- FHIR resources are compatible-shaped prototypes and explicitly not asserted to be formally validated.
- API logs are deliberately minimized and do not retain the full patient mapping request/response.
