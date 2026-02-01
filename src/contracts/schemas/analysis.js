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

const nodeRefSchema = {
  anyOf: [
    {
      type: 'object',
      required: ['type', 'chunkUid'],
      properties: {
        type: { const: 'chunk' },
        chunkUid: { type: 'string', minLength: 1 }
      },
      additionalProperties: true
    },
    {
      type: 'object',
      required: ['type', 'symbolId'],
      properties: {
        type: { const: 'symbol' },
        symbolId: { type: 'string', minLength: 1 }
      },
      additionalProperties: true
    },
    {
      type: 'object',
      required: ['type', 'path'],
      properties: {
        type: { const: 'file' },
        path: { type: 'string', minLength: 1 }
      },
      additionalProperties: true
    }
  ]
};

const candidateRefSchema = {
  type: 'object',
  properties: {
    chunkUid: nullableString,
    symbolId: nullableString,
    path: nullableString,
    symbolKey: nullableString,
    kindGroup: nullableString,
    signatureKey: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

const referenceEnvelopeSchema = {
  type: 'object',
  required: ['v', 'status', 'candidates', 'resolved'],
  properties: {
    v: { type: 'integer' },
    status: { enum: ['resolved', 'ambiguous', 'unresolved'] },
    targetName: nullableString,
    kindHint: nullableString,
    importHint: {
      type: ['object', 'null'],
      properties: {
        moduleSpecifier: nullableString,
        resolvedFile: nullableString
      },
      additionalProperties: true
    },
    candidates: { type: 'array', items: candidateRefSchema },
    resolved: { anyOf: [candidateRefSchema, { type: 'null' }] },
    reason: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

const truncationRecordSchema = {
  type: 'object',
  required: ['scope', 'cap', 'limit'],
  properties: {
    scope: {
      enum: [
        'graph',
        'impact',
        'types',
        'risk',
        'ranking',
        'apiContracts',
        'architecture',
        'suggestTests'
      ]
    },
    cap: {
      enum: [
        'maxDepth',
        'maxFanoutPerNode',
        'maxNodes',
        'maxEdges',
        'maxPaths',
        'maxCandidates',
        'maxWorkUnits',
        'maxWallClockMs'
      ]
    },
    limit: { anyOf: [{ type: 'number' }, { type: 'object' }] },
    observed: { anyOf: [{ type: 'number' }, { type: 'object' }, { type: 'null' }] },
    omitted: { anyOf: [{ type: 'number' }, { type: 'object' }, { type: 'null' }] },
    at: {
      type: ['object', 'null'],
      properties: {
        node: nullableString,
        edge: nullableString
      },
      additionalProperties: true
    },
    note: nullableString
  },
  additionalProperties: true
};

const warningRecordSchema = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    data: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

const provenanceSchema = {
  type: 'object',
  required: ['generatedAt', 'capsUsed'],
  properties: {
    generatedAt: { type: 'string' },
    indexCompatKey: { type: 'string', minLength: 1 },
    indexSignature: { type: 'string', minLength: 1 },
    capsUsed: { type: 'object', additionalProperties: true },
    repo: nullableString,
    indexDir: nullableString
  },
  anyOf: [
    {
      required: ['indexCompatKey'],
      properties: { indexCompatKey: { type: 'string', minLength: 1 } }
    },
    {
      required: ['indexSignature'],
      properties: { indexSignature: { type: 'string', minLength: 1 } }
    }
  ],
  additionalProperties: true
};

const seedRefSchema = { anyOf: [nodeRefSchema, referenceEnvelopeSchema] };

const graphNodeSchema = {
  type: 'object',
  required: ['ref'],
  properties: {
    ref: nodeRefSchema,
    distance: { type: 'number' },
    label: nullableString,
    file: nullableString,
    kind: nullableString,
    name: nullableString,
    signature: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

const graphEdgeSchema = {
  type: 'object',
  required: ['edgeType', 'from', 'to'],
  properties: {
    edgeType: { type: 'string' },
    graph: nullableString,
    from: { anyOf: [nodeRefSchema, referenceEnvelopeSchema] },
    to: { anyOf: [nodeRefSchema, referenceEnvelopeSchema] },
    confidence: nullableNumber,
    evidence: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

const witnessPathSchema = {
  type: 'object',
  required: ['to', 'distance', 'nodes'],
  properties: {
    to: nodeRefSchema,
    distance: { type: 'number' },
    nodes: { type: 'array', items: nodeRefSchema },
    edges: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        required: ['from', 'to', 'edgeType'],
        properties: {
          from: nodeRefSchema,
          to: nodeRefSchema,
          edgeType: { type: 'string' }
        },
        additionalProperties: true
      }
    },
    confidence: nullableNumber,
    partial: { type: 'boolean' },
    unresolvedAt: { type: ['array', 'null'], items: { type: 'number' } }
  },
  additionalProperties: true
};

export const GRAPH_CONTEXT_PACK_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'nodes', 'edges', 'provenance'],
  properties: {
    version: semverString,
    seed: seedRefSchema,
    provenance: provenanceSchema,
    nodes: { type: 'array', items: graphNodeSchema },
    edges: { type: 'array', items: graphEdgeSchema },
    paths: { type: ['array', 'null'], items: witnessPathSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema },
    stats: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: true
};

const impactedNodeSchema = {
  type: 'object',
  required: ['ref', 'distance'],
  properties: {
    ref: nodeRefSchema,
    distance: { type: 'number' },
    confidence: nullableNumber,
    witnessPath: { anyOf: [witnessPathSchema, { type: 'null' }] },
    partial: { type: 'boolean' }
  },
  additionalProperties: true
};

export const GRAPH_IMPACT_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'direction', 'depth', 'impacted', 'provenance'],
  properties: {
    version: semverString,
    seed: seedRefSchema,
    direction: { enum: ['upstream', 'downstream'] },
    depth: { type: 'number' },
    impacted: { type: 'array', items: impactedNodeSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema },
    provenance: provenanceSchema,
    stats: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: true
};

const typeFactSchema = {
  type: 'object',
  required: ['subject', 'role', 'type'],
  properties: {
    subject: nodeRefSchema,
    role: { type: 'string' },
    name: nullableString,
    type: { type: 'string' },
    source: nullableString,
    confidence: nullableNumber
  },
  additionalProperties: true
};

const riskFlowSummarySchema = {
  type: 'object',
  required: ['path'],
  properties: {
    flowId: nullableString,
    sourceChunkUid: nullableString,
    sinkChunkUid: nullableString,
    category: nullableString,
    severity: nullableString,
    confidence: nullableNumber,
    path: {
      type: 'object',
      required: ['nodes'],
      properties: {
        nodes: { type: 'array', items: nodeRefSchema },
        callSiteIdsByStep: { type: ['array', 'null'], items: { type: 'array', items: { type: 'string' } } }
      },
      additionalProperties: true
    },
    evidence: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

export const COMPOSITE_CONTEXT_PACK_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'primary', 'provenance'],
  properties: {
    version: semverString,
    seed: seedRefSchema,
    provenance: provenanceSchema,
    primary: {
      type: 'object',
      required: ['ref', 'file', 'excerpt'],
      properties: {
        ref: nodeRefSchema,
        file: nullableString,
        range: {
          type: ['object', 'null'],
          properties: {
            startLine: { type: 'number' },
            endLine: { type: 'number' }
          },
          additionalProperties: true
        },
        excerpt: { type: 'string' },
        excerptHash: nullableString,
        provenance: { type: ['object', 'null'], additionalProperties: true }
      },
      additionalProperties: true
    },
    graph: { anyOf: [GRAPH_CONTEXT_PACK_SCHEMA, { type: 'null' }] },
    types: {
      type: ['object', 'null'],
      properties: {
        facts: { type: 'array', items: typeFactSchema }
      },
      additionalProperties: true
    },
    risk: {
      type: ['object', 'null'],
      properties: {
        flows: { type: 'array', items: riskFlowSummarySchema }
      },
      additionalProperties: true
    },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema },
    stats: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: true
};

const apiContractEntrySchema = {
  type: 'object',
  required: ['symbol', 'signature', 'observedCalls'],
  properties: {
    symbol: {
      type: 'object',
      required: ['symbolId'],
      properties: {
        symbolId: { type: 'string' },
        chunkUid: nullableString,
        file: nullableString,
        name: nullableString,
        kind: nullableString
      },
      additionalProperties: true
    },
    signature: {
      type: 'object',
      properties: {
        declared: nullableString,
        tooling: nullableString
      },
      additionalProperties: true
    },
    observedCalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          arity: nullableNumber,
          args: { type: ['array', 'null'], items: { type: 'string' } },
          callSiteId: nullableString,
          file: nullableString,
          startLine: nullableNumber,
          confidence: nullableNumber
        },
        additionalProperties: true
      }
    },
    warnings: { type: ['array', 'null'], items: { type: 'object' } },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema }
  },
  additionalProperties: true
};

export const API_CONTRACTS_SCHEMA = {
  type: 'object',
  required: ['version', 'options', 'symbols', 'provenance'],
  properties: {
    version: semverString,
    provenance: provenanceSchema,
    options: {
      type: 'object',
      required: ['onlyExports', 'failOnWarn', 'caps'],
      properties: {
        onlyExports: { type: 'boolean' },
        failOnWarn: { type: 'boolean' },
        caps: {
          type: 'object',
          properties: {
            maxSymbols: { type: 'number' },
            maxCallsPerSymbol: { type: 'number' },
            maxWarnings: { type: 'number' }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    },
    symbols: { type: 'array', items: apiContractEntrySchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};

const architectureViolationSchema = {
  type: 'object',
  required: ['ruleId', 'edge'],
  properties: {
    ruleId: { type: 'string' },
    edge: {
      type: 'object',
      required: ['edgeType', 'from', 'to'],
      properties: {
        edgeType: { type: 'string' },
        from: nodeRefSchema,
        to: nodeRefSchema
      },
      additionalProperties: true
    },
    evidence: { type: ['object', 'null'] }
  },
  additionalProperties: true
};

export const ARCHITECTURE_REPORT_SCHEMA = {
  type: 'object',
  required: ['version', 'rules', 'violations', 'provenance'],
  properties: {
    version: semverString,
    provenance: provenanceSchema,
    rules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type', 'summary'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          severity: nullableString,
          summary: { type: 'object' }
        },
        additionalProperties: true
      }
    },
    violations: { type: 'array', items: architectureViolationSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};

const suggestedTestSchema = {
  type: 'object',
  required: ['testPath', 'score', 'reason'],
  properties: {
    testPath: { type: 'string' },
    score: { type: 'number' },
    reason: { type: 'string' },
    witnessPath: { anyOf: [witnessPathSchema, { type: 'null' }] }
  },
  additionalProperties: true
};

export const SUGGEST_TESTS_SCHEMA = {
  type: 'object',
  required: ['version', 'changed', 'suggestions', 'provenance'],
  properties: {
    version: semverString,
    provenance: provenanceSchema,
    changed: {
      type: 'array',
      items: { type: 'object', required: ['path'], properties: { path: { type: 'string' } }, additionalProperties: true }
    },
    suggestions: { type: 'array', items: suggestedTestSchema },
    truncation: { type: ['array', 'null'], items: truncationRecordSchema },
    warnings: { type: ['array', 'null'], items: warningRecordSchema }
  },
  additionalProperties: true
};
