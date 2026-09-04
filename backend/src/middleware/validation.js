export function validateMapRequest(req, res, next) {
  const { emrPatientId, ayushSystem, legacyTerm, namasteCode, outputFormat = 'FHIR_R4_CONDITION' } = req.body || {};
  if (![emrPatientId, ayushSystem, legacyTerm, namasteCode].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ error: 'emrPatientId, ayushSystem, legacyTerm, and namasteCode are required strings.' });
  if (!['FHIR_R4_CONDITION', 'FHIR_R4_CONCEPTMAP'].includes(outputFormat)) return res.status(400).json({ error: 'Unsupported outputFormat.' });
  next();
}
export function validateConsent(req, res, next) {
  const { patientId, hospitalId, categories, expiresAt } = req.body || {};
  if (!patientId || !hospitalId || !Array.isArray(categories) || !categories.length || Number.isNaN(Date.parse(expiresAt))) return res.status(400).json({ error: 'patientId, hospitalId, non-empty categories, and a valid expiresAt are required.' });
  next();
}
