export function createApiController({ terminology, fhir, consent, abdm, firebase }) {
  return {
    health: (_req, res) => res.json({ status: 'ok', service: 'ayurfhir-backend', mode: 'prototype', timestamp: new Date().toISOString() }),
    search: (req, res) => res.json(terminology.search({ q: req.query.q, stream: req.query.stream })),
    map: async (req, res, next) => {
      try {
        const mapped = terminology.map(req.body);
        if (!mapped) return res.status(404).json({ error: 'No demo mapping found for the supplied terminology.' });
        const fhirResource = req.body.outputFormat === 'FHIR_R4_CONCEPTMAP'
          ? { resourceType: 'ConceptMap', id: `map-${crypto.randomUUID()}`, sourceUri: 'https://example.invalid/demo', targetUri: 'https://id.who.int/icd/release/11/tm2', extension: [{ url: 'https://example.invalid/prototype', valueBoolean: true }] }
          : fhir.toCondition({ patientId: req.body.emrPatientId, concept: mapped.concept });
        const response = { status: 200, requestId: `REQ-${crypto.randomUUID().slice(0, 8)}`, message: 'Demo terminology mapping executed', source: 'demo', mapping: mapped.mapping, fhirResource };
        // Store a minimal operational log; do not retain the full patient request/response payload.
        await firebase.logMappingRequest({ requestId: response.requestId, userUid: req.user?.uid || 'anonymous', userEmail: req.user?.email || 'anonymous', endpoint: '/api/v1/terminology/map', status: 200, namasteCode: mapped.concept.namasteCode, createdAt: new Date().toISOString() });
        res.json(response);
      } catch (error) { next(error); }
    },
    sample: (req, res) => res.json({ source: 'prototype', validated: false, resource: fhir.sample(req.query.type) }),
    createConsent: (req, res) => res.status(201).json({ source: 'mock', consent: consent.create(req.body) }),
    patientRecords: async (req, res, next) => {
      try {
        const hospitalId = req.header('x-hospital-id');
        if (!hospitalId) return res.status(400).json({ error: 'x-hospital-id is required.' });
        if (!consent.allows({ patientId: req.params.id, hospitalId, category: 'clinical-summary' })) return res.status(403).json({ error: 'No active consent grants this hospital access to this record category.' });
        res.json({ source: 'mock-abdm-adapter', records: await abdm.getPatientRecords(req.params.id) });
      } catch (error) { next(error); }
    }
  };
}
