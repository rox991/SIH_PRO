import { DemoNamasteProvider, DemoIcd11Provider, DemoMappingProvider } from '../terminology/providers.js';

export class TerminologyService {
  constructor({ namaste = new DemoNamasteProvider(), icd11 = new DemoIcd11Provider(), mapping = new DemoMappingProvider() } = {}) {
    this.namaste = namaste; this.icd11 = icd11; this.mapping = mapping;
  }
  search({ q, stream }) { return { source: 'demo', concepts: this.namaste.search(q, stream) }; }
  map(input) {
    const concept = this.mapping.map(input);
    if (!concept) return null;
    return { source: 'demo', concept, mapping: { namasteCode: concept.namasteCode, icd11Tm2Code: concept.icd11Tm2Code, icd11MmsCode: concept.icd11MmsCode, snomedCode: concept.snomedCode, confidence: concept.confidence } };
  }
}
