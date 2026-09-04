// Privileged Firebase access is deliberately isolated here. The demo works without credentials.
export class FirebaseAdapter {
  constructor() { this.requests = []; }
  async logMappingRequest(entry) { this.requests.push({ ...entry, id: crypto.randomUUID() }); }
  async verifyToken() { return null; }
}
