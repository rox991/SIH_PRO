const assert = require('assert');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function runTests() {
  console.log(`\n=============================================================`);
  console.log(`  AyurFHIR Terminology Microservice Automated Test Suite`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`=============================================================\n`);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // Test 1: Service Health
  await test('GET /api/health returns UP with version stamps', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'UP');
    assert.ok(data.versionStamps.namasteRelease);
    assert.ok(data.versionStamps.icd11Release);
  });

  // Test 2: Live WHO ICD-11 Container Entity 2066255370
  await test('GET /icd/entity/2066255370 returns Acute nasopharyngitis', async () => {
    const res = await fetch(`${BASE_URL}/icd/entity/2066255370`, {
      headers: {
        'accept': 'application/json',
        'API-Version': 'v2',
        'Accept-Language': 'en'
      }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.title);
    const titleVal = data.title['@value'] || data.title;
    assert.ok(titleVal.toLowerCase().includes('nasopharyngitis') || titleVal.toLowerCase().includes('cold'));
  });

  // Test 3: FHIR ValueSet $expand
  await test('GET /ValueSet/$expand?q=Amlapitta autocompletes with TM2 code', async () => {
    const res = await fetch(`${BASE_URL}/ValueSet/$expand?q=Amlapitta`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.resourceType, 'ValueSet');
    assert.ok(data.expansion.total > 0);
    const item = data.expansion.contains[0];
    assert.strictEqual(item.code, 'NAM-AYU-0012');
    assert.ok(item.extension.some(e => e.valueString && e.valueString.includes('TM2-AYU')));
  });

  // Test 4: FHIR ConceptMap $translate (Valid mapping)
  await test('POST /ConceptMap/$translate returns equivalence and target TM2/MMS', async () => {
    const res = await fetch(`${BASE_URL}/ConceptMap/$translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NAM-AYU-0077' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.resourceType, 'Parameters');
    const resultParam = data.parameter.find(p => p.name === 'result');
    assert.strictEqual(resultParam.valueBoolean, true);
    const matchParam = data.parameter.find(p => p.name === 'match');
    assert.ok(matchParam);
  });

  // Test 5: Honest Semantics & Curation Queue on Unmapped Concept
  await test('POST /ConceptMap/$translate for unmapped concept routes to Curation Queue', async () => {
    const res = await fetch(`${BASE_URL}/ConceptMap/$translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'NAM-AYU-0999' })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const resultParam = data.parameter.find(p => p.name === 'result');
    assert.strictEqual(resultParam.valueBoolean, false);
    const queueParam = data.parameter.find(p => p.name === 'curationQueue');
    assert.strictEqual(queueParam.valueBoolean, true);
  });

  // Test 6: FHIR R4 Bundle POST Dual-Coded Condition Save
  await test('POST /Bundle saves dual-coded Condition into problem list', async () => {
    const res = await fetch(`${BASE_URL}/Bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'NAM-AYU-0077',
        patientId: 'Patient/ABHA-91-4821-3920-1102',
        patientName: 'Anjali R. Deshmukh'
      })
    });
    assert.strictEqual(res.status, 201);
    const bundle = await res.json();
    assert.strictEqual(bundle.resourceType, 'Bundle');
    const cond = bundle.entry[0].resource;
    assert.strictEqual(cond.resourceType, 'Condition');
    assert.strictEqual(cond.clinicalStatus.coding[0].code, 'active');
    // Must contain both NAMASTE and ICD-11 TM2 codings
    const codings = cond.code.coding;
    assert.ok(codings.some(c => c.system.includes('namaste')));
    assert.ok(codings.some(c => c.system.includes('tm2')));
  });

  // Test 7: Static Files Served
  await test('GET / and GET /admin.html serve successfully', async () => {
    const rIndex = await fetch(`${BASE_URL}/`);
    assert.strictEqual(rIndex.status, 200);
    const rAdmin = await fetch(`${BASE_URL}/admin.html`);
    assert.strictEqual(rAdmin.status, 200);
  });

  console.log(`\n=============================================================`);
  console.log(`  Tests Passed: ${passed} / ${passed + failed}`);
  console.log(`=============================================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
