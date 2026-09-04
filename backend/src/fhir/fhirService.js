export class FhirService {
  toCondition({ patientId, concept }) {
    return { resourceType: 'Condition', id: `condition-${crypto.randomUUID()}`, subject: { reference: `Patient/${patientId}` }, code: { coding: [{ system: 'https://example.invalid/namaste-demo', code: concept.namasteCode, display: concept.termEnglish }, { system: 'https://id.who.int/icd/release/11/tm2', code: concept.icd11Tm2Code }] }, extension: [{ url: 'https://example.invalid/prototype', valueBoolean: true }] };
  }
  sample(type = 'condition') {
    if (type === 'patient') return { resourceType: 'Patient', id: 'PAT-9942', name: [{ family: 'Sharma', given: ['Rajeev'] }], extension: [{ url: 'https://example.invalid/prototype', valueBoolean: true }] };
    return { resourceType: 'Condition', id: 'cond-demo-001', code: { coding: [{ system: 'https://example.invalid/namaste-demo', code: 'NAM-AYU-0012', display: 'Amlapitta' }] }, extension: [{ url: 'https://example.invalid/prototype', valueBoolean: true }] };
  }
}
