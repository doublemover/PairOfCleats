const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };

const typeEntry = {
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

const typeEntryList = { type: 'array', items: typeEntry };

const typeBucket = {
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

const metaTypes = {
  type: ['object', 'null'],
  properties: {
    declared: typeBucket,
    inferred: typeBucket,
    tooling: typeBucket
  },
  additionalProperties: true
};

const riskFlowEntry = {
  type: 'object',
  required: ['source', 'sink'],
  properties: {
    source: { type: 'string' },
    sink: { type: 'string' },
    scope: nullableString,
    severity: nullableString,
    category: nullableString,
    confidence: nullableNumber,
    ruleIds: { type: ['array', 'null'], items: { type: 'string' } },
    evidence: { type: ['object', 'null'] },
    via: nullableString
  },
  additionalProperties: true
};

export const METADATA_V2_SCHEMA = {
  type: 'object',
  required: ['chunkId', 'file'],
  properties: {
    chunkId: { type: 'string' },
    chunkUid: { type: 'string' },
    chunkUidAlgoVersion: nullableString,
    spanHash: nullableString,
    preHash: nullableString,
    postHash: nullableString,
    collisionOf: nullableString,
    virtualPath: nullableString,
    file: { type: 'string' },
    fileHash: nullableString,
    fileHashAlgo: nullableString,
    segment: {
      type: ['object', 'null'],
      properties: {
        segmentId: nullableString,
        segmentUid: nullableString,
        virtualPath: nullableString,
        type: nullableString,
        languageId: nullableString,
        ext: nullableString,
        parentSegmentId: nullableString,
        start: { type: ['integer', 'null'], minimum: 0 },
        end: { type: ['integer', 'null'], minimum: 0 },
        startLine: { type: ['integer', 'null'], minimum: 0 },
        endLine: { type: ['integer', 'null'], minimum: 0 },
        embeddingContext: nullableString
      },
      additionalProperties: true
    },
    range: {
      type: ['object', 'null'],
      properties: {
        start: { type: ['integer', 'null'], minimum: 0 },
        end: { type: ['integer', 'null'], minimum: 0 },
        startLine: { type: ['integer', 'null'], minimum: 0 },
        endLine: { type: ['integer', 'null'], minimum: 0 }
      },
      additionalProperties: true
    },
    lang: nullableString,
    ext: nullableString,
    container: {
      type: ['object', 'null'],
      properties: {
        ext: nullableString,
        languageId: nullableString
      },
      additionalProperties: true
    },
    effective: {
      type: ['object', 'null'],
      properties: {
        ext: nullableString,
        languageId: nullableString
      },
      additionalProperties: true
    },
    kind: nullableString,
    name: nullableString,
    signature: nullableString,
    doc: nullableString,
    generatedBy: nullableString,
    tooling: {
      type: ['object', 'null'],
      properties: {
        tool: nullableString,
        version: nullableString,
        configHash: nullableString
      },
      additionalProperties: true
    },
    parser: {
      type: ['object', 'null'],
      properties: {
        name: nullableString,
        version: nullableString
      },
      additionalProperties: true
    },
    annotations: { type: ['array', 'null'], items: { type: 'string' } },
    modifiers: {
      anyOf: [
        { type: ['array', 'null'], items: { type: 'string' } },
        { type: 'object', additionalProperties: true }
      ]
    },
    params: { type: ['array', 'null'], items: { type: 'string' } },
    tags: { type: ['array', 'null'], items: { type: 'string' } },
    types: metaTypes,
    risk: {
      type: ['object', 'null'],
      properties: {
        tags: { type: ['array', 'null'], items: { type: 'string' } },
        categories: { type: ['array', 'null'], items: { type: 'string' } },
        severity: nullableString,
        confidence: nullableNumber,
        sources: { type: ['array', 'null'], items: { type: 'object' } },
        sinks: { type: ['array', 'null'], items: { type: 'object' } },
        sanitizers: { type: ['array', 'null'], items: { type: 'object' } },
        flows: { type: ['array', 'null'], items: riskFlowEntry },
        analysisStatus: { type: ['object', 'null'] },
        ruleProvenance: { type: ['object', 'null'] }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

const riskRuleSchema = {
  type: 'object',
  required: ['id', 'name', 'patterns'],
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    name: { type: 'string' },
    category: nullableString,
    severity: nullableString,
    tags: { type: 'array', items: { type: 'string' } },
    confidence: nullableNumber,
    languages: { type: ['array', 'null'], items: { type: 'string' } },
    patterns: { type: 'array', items: { type: 'string' } },
    requires: nullableString
  },
  additionalProperties: true
};

export const RISK_RULES_BUNDLE_SCHEMA = {
  type: 'object',
  required: ['version', 'sources', 'sinks', 'sanitizers'],
  properties: {
    version: semverString,
    sources: { type: 'array', items: riskRuleSchema },
    sinks: { type: 'array', items: riskRuleSchema },
    sanitizers: { type: 'array', items: riskRuleSchema },
    regexConfig: {
      type: ['object', 'null'],
      properties: {
        maxPatternLength: { type: ['integer', 'null'] },
        maxInputLength: { type: ['integer', 'null'] },
        maxProgramSize: { type: ['integer', 'null'] },
        timeoutMs: { type: ['integer', 'null'] },
        flags: nullableString,
        engine: nullableString
      },
      additionalProperties: true
    },
    provenance: {
      type: ['object', 'null'],
      properties: {
        defaults: { type: 'boolean' },
        sourcePath: nullableString
      },
      additionalProperties: true
    },
    diagnostics: {
      type: ['object', 'null'],
      properties: {
        warnings: { type: ['array', 'null'], items: { type: 'object' } },
        errors: { type: ['array', 'null'], items: { type: 'object' } }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

export const ANALYSIS_POLICY_SCHEMA = {
  type: 'object',
  properties: {
    metadata: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' }
      },
      additionalProperties: true
    },
    risk: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' },
        crossFile: { type: 'boolean' }
      },
      additionalProperties: true
    },
    git: {
      type: ['object', 'null'],
      properties: {
        enabled: { type: 'boolean' },
        blame: { type: 'boolean' },
        churn: { type: 'boolean' }
      },
      additionalProperties: true
    },
    typeInference: {
      type: ['object', 'null'],
      properties: {
        local: {
          type: ['object', 'null'],
          properties: {
            enabled: { type: 'boolean' }
          },
          additionalProperties: true
        },
        crossFile: {
          type: ['object', 'null'],
          properties: {
            enabled: { type: 'boolean' }
          },
          additionalProperties: true
        },
        tooling: {
          type: ['object', 'null'],
          properties: {
            enabled: { type: 'boolean' }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};
