export class MockAbdmAdapter {
  async getPatientRecords(patientId) { return [{ id: `record-${patientId}-1`, category: 'clinical-summary', source: 'mock-abdm-adapter', data: 'Synthetic prototype record only.' }]; }
}
