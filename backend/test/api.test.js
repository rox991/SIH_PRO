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
