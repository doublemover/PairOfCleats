export const nullableString = { type: ['string', 'null'] };
export const nullableNumber = { type: ['number', 'null'] };
export const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };
export const riskWatchSemanticKinds = ['wrapper', 'propagator', 'builder', 'callback', 'asyncHandoff'];
export const riskWatchSemanticsSchema = {
  semanticIds: { type: 'array', items: { type: 'string' } },
  semanticKinds: {
    type: 'array',
    items: { enum: riskWatchSemanticKinds }
  }
};

export const typeEntry = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { type: 'string' },
    source: nullableString,
    confidence: nullableNumber,
    evidence: { type: ['object', 'null'] },
    shape: { type: ['object', 'null'] },
    elements: { type: ['array', 'null'], items: { type: 'string' } }
  },
  additionalProperties: true
};

export const typeEntryList = { type: 'array', items: typeEntry };

export const typeBucket = {
  type: 'object',
  additionalProperties: {
    anyOf: [
      typeEntryList,
      {
        type: 'object',
        additionalProperties: typeEntryList
      }
    ]
  }
};

export const metaTypes = {
  type: ['object', 'null'],
  properties: {
    declared: typeBucket,
    inferred: typeBucket,
    tooling: typeBucket
  },
  additionalProperties: true
};
