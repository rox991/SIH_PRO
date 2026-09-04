# AyurFHIR Bridge — Node.js refactor

This experimental branch converts the original two-page Firebase prototype into a frontend plus Express backend structure.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`. One command, one process. `server.js` handles the terminology
API and the portal, and delegates the admin console and auth to the backend app it imports
from `backend/src/app.js`:

| Path | Served by | What it is |
| --- | --- | --- |
| `/` | `server.js` | practitioner portal (`index.html`) — patient, hospital and insurer portals |
| `/admin/` | backend | admin console — Users & Roles, Audit Logs, Live API Request Monitor |
| `/patient/` | backend | the older standalone patient page |
| `/shared/*` | backend | frontend ES modules |
| `/api/v1/auth/*`, `/api/v1/admin/*` | backend | Firebase auth and admin API |
| `/api/health`, `/api/curation` | `server.js` | health and curation queue |
| `/ValueSet/$expand`, `/ConceptMap/$translate`, `/Bundle` | `server.js` | FHIR R4 terminology operations |
| `/icd/*` | `server.js` | WHO ICD-11 container proxy (`ICD11_HOST`, default `http://localhost`) |

`/admin` and `/admin.html` both redirect to `/admin/`, so the portal's "Open Admin Console"
button lands on the real console.

The backend is imported, not spawned — it only calls `listen()` when run directly, so this is a
single process on a single port. If it fails to load, the portal and terminology API keep working
and `/admin/` returns 503.

`npm test` runs `test.js` against a running server on port 3000.

### Other entry points

Not needed for normal development; they exist for working on a sub-app in isolation:

| Command | Port | Serves |
| --- | --- | --- |
| `npm run dev:client` | 5173 | `client/server.js` — hospital EMR client, own copy of the pages |
| `npm run dev:admin` | 5174 | `admin/server.js` — own copy of the pages |
| `npm run dev:backend` | 3000 | `backend/src/app.js` alone, without the terminology API |

## Firestore security rules

`firestore.rules` governs what the **browser** may do. The backend uses the Admin SDK, which
bypasses rules entirely, so nothing here can lock the server out.

```bash
npx firebase deploy --only firestore:rules
```

Firestore denies everything by default, so the portal will fail closed until these are deployed.

Ownership is always proven from a stored document, never from a client-supplied value: a patient
owns `abha/<abhaKey>` and a facility owns `hips/<hipId>`, each via its `ownerUid`. The rules read
the `_parent`/`_key` fields the Firestore adapter writes, rather than parsing document ids.

The rule that matters most is on `users/{uid}`. The portal's signup form writes `role` straight
from a `<select>`, and the backend's `requireRole('admin')` reads that same field — so an
unconstrained write there would let any browser grant itself the admin API. The client is limited
to `patient`, `hospital` and `user`, and can neither introduce nor retain `admin`; only the Admin
SDK can set that. Admin reads are gated on the `role` **custom claim**, which the backend sets via
`setCustomUserClaims` and a browser cannot forge.

Other invariants worth knowing:

- `abhaDirectory` is readable by any signed-in user on purpose — a facility resolves a patient by
  ABHA address before any consent exists, and those records are masked by construction.
- A facility can offer a record (`linkRequests`) but only the patient can approve it, and the
  attached bundle cannot be altered during approval.
- `careContexts` is written by the patient alone; records arrive there only through an approved
  link request.
- Neither party can rewrite who a consent is between, what it covers, or when it expires.
- `dataAccessLogs` and `auditLogs` are append-only for everyone, including the patient.
- **The decision on a consent is the patient's alone.** A requester — hospital or insurer — may
  only revoke; it cannot flip its own request to `GRANTED`. That never disclosed anything (the
  payload under `disclosures/<cid>` is still writable by the patient only), but without the rule a
  requester could display a grant that was never signed and write `CONSENT_GRANTED` into the
  patient's ledger.

### Insurance collections

`policyDirectory` is the one lookup that is deliberately **not** open the way `abhaDirectory` is. An
ABHA address is chosen by its owner; a policy number is issued by a company and printed on paper
that changes hands, so a directory readable by any signed-in user would be a fishing licence. A
`get` therefore resolves only for the policyholder or the insurer named in the document, `list` is
admin-only, and only the patient may write it — an insurer cannot attach a policy to an ABHA that
has not claimed it. A number that does not exist and a number belonging to a rival insurer both
come back denied, which is the same answer on purpose.

| Collection | Written by | Read by |
| --- | --- | --- |
| `insurers/<insurerId>` | the owning account | the owner (holds the API key hash) |
| `insurerDirectory/<insurerId>` | the owning account | any signed-in user, so a patient can pick an insurer |
| `policyDirectory/<policyKey>` | the patient only | the policyholder, and the issuing insurer |
| `patientPolicies/<abhaKey>/<policyKey>` | the patient | the patient |
| `insurerConsents/<insurerId>/<cid>` | the requesting insurer | that insurer |

The rules for all of the above are covered by an emulator test suite. It is not wired into
`npm test`, because it needs the emulator and two extra packages:

```bash
npm i --no-save @firebase/rules-unit-testing firebase
npx firebase-tools emulators:exec --only firestore "node test/firestore-rules.test.mjs"
```

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

## The insurance portal

A third portal sits beside the patient and hospital ones, for insurers and TPAs. Its entry point is
the **policy number and nothing else** — no ABHA address, no phone number, no name.

1. **The patient links the policy.** In the patient portal, *My insurance policies* attaches a
   policy number to their ABHA, choosing the insurer from the public `insurerDirectory`. This is the
   only way a policy number ever becomes resolvable, and it grants the insurer nothing.
2. **The insurer resolves a claimant.** Typing the policy number returns masked demographics and the
   cover period — enough to confirm the right person, and no diagnosis, facility or treatment date.
3. **The insurer raises a claim request.** Purpose is pinned to `HPAYMT` (Healthcare Payment); a
   payer cannot dress a claim check up as care management. The request carries the claim reference
   and the policy number, and the date range defaults to the cover period rather than all of time.
4. **The patient signs it, record by record**, in the same OTP-signed review a hospital request goes
   through — with the requester shown as an insurer, and the policy number they were found by
   spelled out.
5. **The insurer reads the disclosure**, and gets a claims-oriented view: the ICD-11 MMS codes to
   adjudicate on, pulled out of the FHIR bundles, beside the NAMASTE terms the AYUSH practitioner
   actually recorded.

Consent is not skipped because the identifier is a policy number. A claim consent reuses the same
consent document, signature, disclosure payload and append-only ledger a hospital request uses —
`requesterType` distinguishes them and `insurerId` is what the security rules authorise against — so
a revoke kills an insurer's access mid-session exactly as it kills a hospital's.

## FHIR responses have a GUI

Every FHIR surface used to end at a `<pre>` of JSON. Each now has a **Visual / JSON** pair of tabs
filled from the same object, so the wire format and the reading of it cannot drift apart:

- the **FHIR Resource Explorer**, where Validate still parses the JSON pane
- both **record viewers** — the patient's own records, and what a hospital or insurer fetched
- the **API console** response, including non-FHIR bodies and error envelopes

The renderer handles Bundle, Composition, Patient, Organization, Condition, MedicationRequest,
DiagnosticReport, Observation, Consent, Provenance, ConceptMap, ValueSet, CapabilityStatement,
Parameters and OperationOutcome, and falls back to a readable field grid for anything else. Codings
are chips labelled by system, so a dual-coded `CodeableConcept` reads as *one concept, four systems*
at a glance; `$translate` shows equivalence and a confidence bar; `$expand` shows each concept with
its cross-codes.

Bundles arrive from other parties through disclosures, so a resource is untrusted input. Narrative
`text.div` is XHTML by spec and is stripped to plain text rather than injected, and every value is
escaped before it is concatenated.

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
- Insurers are self-registered: the IRDAI registration number is stored as typed and is not verified
  against any registry, and nothing checks that a policy number a patient links was ever issued to
  them. Both are the same class of prototype gap as the mock ABHA issuance, and both are contained
  by the same rule — a policy link discloses nothing on its own, and every read still needs a
  signed consent.
- FHIR resources are compatible-shaped prototypes and explicitly not asserted to be formally validated.
- API logs are deliberately minimized and do not retain the full patient mapping request/response.
- ICD-11 browsing is read-only reference data and, like the demo terminology search, is open to unauthenticated callers. Using the WHO ICD-API requires accepting its licence terms.
