import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../src/app.js';

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('health and terminology mapping endpoints work with demo data', async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());

  assert.equal(health.status, 'ok');

  const mapping = await fetch(`${baseUrl}/api/v1/terminology/map`, {
  
    method: 'POST', headers: { 'content-type': 'application/json' },
  
    body: JSON.stringify({ emrPatientId: 'PAT-9942', ayushSystem: 'Ayurveda', legacyTerm: 'Amlapitta', namasteCode: 'NAM-AYU-0012' })
  
  }).then((response) => response.json());
  
  assert.equal(mapping.source, 'demo');
  
  assert.equal(mapping.fhirResource.resourceType, 'Condition');
});

test('patient and admin frontends are served', async () => {
  
  const patient = await fetch(`${baseUrl}/patient/`);
  
  const admin = await fetch(`${baseUrl}/admin/`);
  
  assert.equal(patient.status, 200);
  
  assert.match(await patient.text(), /NAMASTE to ICD-11/);
  
  assert.equal(admin.status, 200);
  
  assert.match(await admin.text(), /Admin Console/);
});

test('records need active consent', async () => {
  
  const blocked = await fetch(`${baseUrl}/api/v1/patients/PAT-1/records`, { headers: { 'x-hospital-id': 'hospital-1' } });
  
  assert.equal(blocked.status, 403);
  
  const consent = await fetch(`${baseUrl}/api/v1/consent`, {
  
    method: 'POST', headers: { 'content-type': 'application/json' },
  
    body: JSON.stringify({ patientId: 'PAT-1', hospitalId: 'hospital-1', categories: ['clinical-summary'], expiresAt: '2099-01-01T00:00:00.000Z' })
  
  });
  
  assert.equal(consent.status, 201);
  
  const allowed = await fetch(`${baseUrl}/api/v1/patients/PAT-1/records`, { headers: { 'x-hospital-id': 'hospital-1' } });
  
  assert.equal(allowed.status, 200);
});

test('auth config is served to the browser without leaking the service account', async () => {
  const payload = await fetch(`${baseUrl}/api/v1/auth/config`).then((response) => response.json());

  assert.equal(typeof payload.configured, 'boolean');
  assert.ok(Object.hasOwn(payload.firebase, 'apiKey'));
  assert.equal(JSON.stringify(payload).includes('private_key'), false);
});

test('unauthenticated requests get no session and no admin access', async () => {
  const session = await fetch(`${baseUrl}/api/v1/auth/session`).then((response) => response.json());

  assert.equal(session.authenticated, false);
  assert.equal(session.user, null);

  const users = await fetch(`${baseUrl}/api/v1/admin/users`);
  assert.equal(users.status, 401);
});

test('a forged bearer token is rejected and client-supplied roles are ignored', async () => {
  const forged = await fetch(`${baseUrl}/api/v1/admin/users`, {
    headers: { authorization: 'Bearer not-a-real-token', 'x-demo-role': 'admin' }
  });

  // Without a service account the demo identity is 'user' at best; it must never reach admin routes
  // by asking for the role in a header alongside a bogus token.
  assert.equal(forged.status, 401);

  const promoted = await fetch(`${baseUrl}/api/v1/admin/users`, {
    headers: { 'x-demo-user-id': 'demo-user', 'x-demo-role': 'admin' }
  });
  assert.equal(promoted.status, 403);
});

// The ICD-11 routes proxy a WHO ICD-API container that may or may not be running on the machine
// executing the tests, so these assert the contract that holds either way: the endpoints exist,
// report their own reachability, validate input before going upstream, and never 500.
test('ICD-11 status reports whether the WHO ICD-API is reachable', async () => {
  const status = await fetch(`${baseUrl}/api/v1/icd11/status`).then((response) => response.json());

  assert.equal(status.configured, true);
  assert.equal(typeof status.reachable, 'boolean');
  if (status.reachable) {
    assert.match(status.releaseId, /^\d{4}-\d{2}$/);
    assert.ok(status.linearizations.includes('mms'));
  } else {
    assert.equal(typeof status.error, 'string');
  }
});

test('ICD-11 search validates its query before calling upstream', async () => {
  const tooShort = await fetch(`${baseUrl}/api/v1/icd11/search?q=a`);
  assert.equal(tooShort.status, 400);

  const badId = await fetch(`${baseUrl}/api/v1/icd11/entity/not-a-number`);
  assert.equal(badId.status, 400);
});

test('ICD-11 search returns normalised, HTML-safe entities when the API is up', async () => {
  const { reachable } = await fetch(`${baseUrl}/api/v1/icd11/status`).then((response) => response.json());
  if (!reachable) return; // Nothing to assert against without the container.

  const payload = await fetch(`${baseUrl}/api/v1/icd11/search?q=asthma`).then((response) => response.json());
  assert.equal(payload.source, 'icd-api');
  assert.ok(payload.results.length > 0);

  const hit = payload.results[0];
  assert.match(hit.entityId, /^\d+$/);
  // Plain titles carry no markup, and the highlighted variant only ever contains <mark>.
  assert.equal(/<[a-z]/i.test(hit.title), false);
  assert.equal(/<(?!\/?mark>)/.test(hit.titleHtml), false);

  const { entity } = await fetch(`${baseUrl}/api/v1/icd11/entity/${hit.entityId}`).then((response) => response.json());
  assert.equal(entity.entityId, hit.entityId);
  assert.equal(typeof entity.title, 'string');
  assert.ok(Array.isArray(entity.exclusions));

  const missing = await fetch(`${baseUrl}/api/v1/icd11/entity/99999999`);
  assert.equal(missing.status, 404);
});
