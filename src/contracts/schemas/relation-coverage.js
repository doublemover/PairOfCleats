export const crossFileCoverageSchema = {
  type: ['object', 'null'],
  required: ['schemaVersion', 'policy', 'admission', 'analysis', 'fingerprint'],
  properties: {
    schemaVersion: { const: 1 },
    policy: { type: ['object', 'null'], required: ['schemaVersion', 'mode', 'source', 'scope', 'ordering', 'rawSignals'],
      properties: { schemaVersion: { const: 1 }, mode: { enum: ['bounded', 'comprehensive'] },
        source: { enum: ['default', 'config'] }, scope: { const: 'collected-supported-cross-file-candidates' },
        ordering: { const: 'canonical-file-round-robin-v1' }, rawSignals: { const: 'preserved' } }, additionalProperties: false },
    admission: { type: 'object', required: ['status', 'firstLayer', 'propagation'],
      properties: { status: { enum: ['complete', 'incomplete', 'unknown'] },
        firstLayer: { type: ['object', 'null'] }, propagation: { type: ['object', 'null'] } }, additionalProperties: false },
    analysis: { type: 'object', required: ['status', 'reasons'],
      properties: { status: { enum: ['complete', 'incomplete', 'unknown'] },
        reasons: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
    fingerprint: { type: ['string', 'null'] }
  },
  additionalProperties: false
};
