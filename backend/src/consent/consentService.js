export class ConsentService {
  constructor() { this.consents = new Map(); }
  create({ patientId, hospitalId, categories, expiresAt }) {
    const consent = { id: crypto.randomUUID(), patientId, hospitalId, categories, expiresAt, status: 'active', createdAt: new Date().toISOString() };
    this.consents.set(consent.id, consent); return consent;
  }
  allows({ patientId, hospitalId, category }) {
    const now = Date.now();
    return [...this.consents.values()].some((c) => c.status === 'active' && c.patientId === patientId && c.hospitalId === hospitalId && c.categories.includes(category) && new Date(c.expiresAt).getTime() > now);
  }
}
