# AyurFHIR Bridge — Node.js refactor

This experimental branch converts the original two-page Firebase prototype into a frontend plus Express backend structure.

## Run locally

```bash
npm install
cp backend/.env.example backend/.env   # then fill in the Firebase values below
npm run dev
```

Open `http://localhost:3000/`. The Express process serves:

- `/patient/` — practitioner portal
- `/admin/` — administration UI
- `/api/health` — backend health endpoint

The app boots without Firebase credentials, but sign-in stays disabled and the portal runs in guest mode.

## Firebase setup

Login uses **Firebase Authentication (Email/Password)** in the browser and **Firebase Admin + Cloud Firestore** on the server. Fill `backend/.env` from `backend/.env.example`:

1. **Enable the provider** — Firebase Console → Authentication → Sign-in method → enable *Email/Password*.
2. **Enable Firestore** — Console → Build → Firestore Database → Create database. Profiles are written to `users/{uid}` and request logs to `apiRequests/{id}` by the server only.
3. **Web config** — Console → Project settings → General → Your apps → Web app. Copy into `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`. These are public by design and are served to the browser by `GET /api/v1/auth/config`; the pages no longer hardcode them.
4. **Service account** — Console → Project settings → Service accounts → Generate new private key. Save it outside version control (`backend/secrets/` is gitignored) and point `FIREBASE_SERVICE_ACCOUNT_PATH` at it, or paste the JSON into `FIREBASE_SERVICE_ACCOUNT_JSON`. **This is a server-only secret — never ship it to the browser.**
5. **First admin** — put your email in `ADMIN_BOOTSTRAP_EMAILS`. That account gets `role: admin` on first sign-in; it can then promote others from the admin console.
6. **Deployed domains** — Console → Authentication → Settings → Authorized domains must list the host you serve from.

### How a login flows

1. The browser signs in with Firebase Auth and receives an ID token.
2. `frontend/shared/api.js` sends that token as `Authorization: Bearer …` on every API call.
3. `backend/src/middleware/auth.js` verifies it with the Admin SDK, then loads the profile from Firestore.
4. The **role comes back from the server**, never from a browser-side database read, so the client cannot self-promote.

## API

- `GET /api/health`
- `GET /api/v1/auth/config` — browser-safe Firebase Web config
- `GET /api/v1/auth/session` — the verified caller's uid, email, name, and role
- `POST /api/v1/auth/register` — creates the server-owned profile after client-side signup (role in the body is ignored)
- `GET /api/v1/admin/users`, `POST /api/v1/admin/users/:uid/role`, `GET /api/v1/admin/requests` — admin role required
- `GET /api/v1/terminology/search?q=Amlapitta&stream=Ayurveda`
- `GET /api/v1/icd11/status` — release, linearization, and whether the ICD-API container answers
- `GET /api/v1/icd11/search?q=asthma&chapter=12&flexible=true` — full-text disease search
- `GET /api/v1/icd11/entity/:id` — one entity with definition, inclusions, exclusions, index terms, parents, children
- `GET /api/v1/icd11/code/:code` — reverse lookup from an ICD-11 code (e.g. `5A11`)
- `GET /api/v1/icd11/chapters` — the 28 top-level chapters
- `GET /api/v1/icd11/autocode?q=chronic+cough` — best-match code for free clinical text
- `POST /api/v1/terminology/map`
- `GET /api/v1/fhir/sample?type=condition`
- `POST /api/v1/consent`
- `GET /api/v1/patients/:id/records` (requires an active mock consent and `x-hospital-id`)

Mapping input requires `emrPatientId`, `ayushSystem`, `legacyTerm`, `namasteCode`, and an optional supported `outputFormat`.

## WHO ICD-11 integration

The `/api/v1/icd11/*` routes proxy a **WHO ICD-API container**, which is normally run locally:

```bash
docker run -p 80:80 -e acceptLicense=true -e saveAnalytics=false whoicd/icd-api
```

Point the backend at it with `ICD_API_BASE_URL` (default `http://localhost`). The container serves
the classification without OAuth, so no client id/secret is needed — unlike the hosted
`id.who.int` API. Leaving `ICD_API_RELEASE_ID` empty makes the backend ask the container which
release it ships, so a container upgrade needs no config change.

Both portals get an **ICD-11 Disease Search** button in the sidebar. It opens a browser over the
live classification: chapter drill-down, full-text and flexible search, direct code lookup,
best-match autocoding for free text, and a detail panel with definitions, inclusions, exclusions,
synonyms, index terms, postcoordination axes, and clickable parents/children. Both pages render it
from the single `frontend/shared/icd-explorer.js` module.

Search titles arrive from the API wrapped in its own `<em class='found'>` match markers. The
backend escapes every title and then reintroduces only those markers as `<mark>`, so classification
content can never inject markup into either portal.

If the container is not running, the endpoints answer `503` with the reason and the portals show an
offline notice instead of failing silently.

## Architecture

`backend/src` owns API routes, input validation, terminology mapping, FHIR construction, consent, and integration boundaries. Demo NAMASTE/ICD-11 mappings and ABDM records are explicitly mock data. They are isolated so official providers can replace them later.

`frontend/shared/firebase-auth.js` is the only place the browser touches Firebase Auth; `frontend/shared/api.js` is the API client and attaches the ID token. `patient-api.js` and `admin-api.js` wire those into the two pages, whose inline scripts now only handle presentation. The Realtime Database SDK is gone from both pages.

`backend/src/integrations/icd/icdAdapter.js` is the ICD-API boundary (HTTP, timeouts, release discovery, TTL cache) and `backend/src/services/icdService.js` normalises the API's JSON-LD into the flat, HTML-safe shape the portals consume.

`backend/src/integrations/firebase/firebaseAdapter.js` is the server-side Firebase boundary: token verification, Firestore profiles, roles, and custom claims. Without a service account it falls back to an in-memory store and verifies nothing, which keeps the demo and tests runnable.

## Security and prototype limits

- Roles are assigned server-side only. The patient signup form no longer offers an "admin" option, and the admin signup form creates an ordinary account unless the email is in `ADMIN_BOOTSTRAP_EMAILS`.
- Development identity headers (`x-demo-*`) work only when no service account is configured, never in production, and are hard-capped at the `user` role so they cannot reach admin routes.
- Without a service account the backend does not verify ID tokens at all — treat that mode as a demo, not as authentication.
- The admin console's "Offline Demo" bypass is presentation-only; it holds no server session, so the live Users and Requests tabs stay empty.
- Consent and ABDM use in-memory mock adapters. No ABHA/Aadhaar lookup is implemented.
- FHIR resources are compatible-shaped prototypes and explicitly not asserted to be formally validated.
- API logs are deliberately minimized and do not retain the full patient mapping request/response.
- ICD-11 browsing is read-only reference data and, like the demo terminology search, is open to unauthenticated callers. Using the WHO ICD-API requires accepting its licence terms.
