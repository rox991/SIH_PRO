import { demoConcepts } from './demoData.js';

export class DemoNamasteProvider {
  search(query, stream) {
    const needle = (query || '').toLowerCase().trim();
    return demoConcepts.filter((concept) =>
      (!stream || stream === 'ALL' || concept.ayushStream === stream) &&
      (!needle || Object.values(concept).some((value) => String(value).toLowerCase().includes(needle)))
    );
  }
}

export class DemoIcd11Provider { getByNamasteCode(code) { return demoConcepts.find((item) => item.namasteCode === code) || null; } }
export class DemoMappingProvider { map({ namasteCode, legacyTerm }) { return demoConcepts.find((item) => item.namasteCode === namasteCode || item.termEnglish.toLowerCase() === String(legacyTerm || '').toLowerCase()) || null; } }
