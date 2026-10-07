const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const posInt = { type: 'integer', minimum: 1 };
const riskWatchSemanticKinds = ['wrapper', 'propagator', 'builder', 'callback', 'asyncHandoff'];
const riskWatchSemanticsSchema = {
  semanticIds: { type: 'array', items: { type: 'string' } },
  semanticKinds: {
    type: 'array',
    items: { enum: riskWatchSemanticKinds }
  }
};

const riskFlowWatchStep = {
  type: 'object',
  required: [
    'taintIn',
    'taintOut',
    'propagatedArgIndices',
    'boundParams',
    'calleeNormalized',
    'sanitizerPolicy',
    'sanitizerBarrierApplied',
    'sanitizerBarriersBefore',
    'sanitizerBarriersAfter',
    'confidenceBefore',
    'confidenceAfter',
    'confidenceDelta'
  ],
  properties: {
    taintIn: { type: 'array', items: { type: 'string' } },
    taintOut: { type: 'array', items: { type: 'string' } },
    propagatedArgIndices: { type: 'array', items: intId },
    boundParams: { type: 'array', items: { type: 'string' } },
    calleeNormalized: nullableString,
    ...riskWatchSemanticsSchema,
    sanitizerPolicy: nullableString,
    sanitizerBarrierApplied: { type: 'boolean' },
    sanitizerBarriersBefore: intId,
    sanitizerBarriersAfter: intId,
    confidenceBefore: { type: ['number', 'null'] },
    confidenceAfter: { type: ['number', 'null'] },
    confidenceDelta: { type: ['number', 'null'] }
  },
  additionalProperties: false
};

const evidenceRef = {
  type: 'object',
  required: ['file', 'startLine', 'startCol', 'endLine', 'endCol', 'snippetHash'],
  properties: {
    file: { type: 'string' },
    startLine: posInt,
    startCol: posInt,
    endLine: posInt,
    endCol: posInt,
    snippetHash: nullableString
  },
  additionalProperties: true
};

const riskSignalSummary = {
  type: 'object',
  required: ['ruleId', 'ruleName', 'ruleType', 'category', 'severity', 'confidence', 'tags', 'evidence'],
  properties: {
    ruleId: { type: 'string' },
    ruleName: { type: 'string' },
    ruleType: { type: 'string' },
    category: nullableString,
    severity: nullableString,
    confidence: { type: ['number', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: evidenceRef }
  },
  additionalProperties: true
};

const riskLocalFlowSummary = {
  type: 'object',
  required: ['sourceRuleId', 'sinkRuleId', 'category', 'severity', 'confidence', 'evidence'],
  properties: {
    sourceRuleId: { type: 'string' },
    sinkRuleId: { type: 'string' },
    category: nullableString,
    severity: nullableString,
    confidence: { type: ['number', 'null'] },
    evidence: { type: 'array', items: evidenceRef }
  },
  additionalProperties: true
};

const riskSummaryRow = {
  type: 'object',
  required: ['schemaVersion', 'chunkUid', 'file', 'signals', 'totals', 'truncated'],
  properties: {
    schemaVersion: posInt,
    chunkUid: { type: 'string' },
    file: { type: 'string' },
    languageId: nullableString,
    symbol: {
      type: 'object',
      required: ['name', 'kind', 'signature'],
      properties: {
        name: nullableString,
        kind: nullableString,
        signature: nullableString
      },
      additionalProperties: true
    },
    signals: {
      type: 'object',
      required: ['sources', 'sinks', 'sanitizers', 'localFlows'],
      properties: {
        sources: { type: 'array', items: riskSignalSummary },
        sinks: { type: 'array', items: riskSignalSummary },
        sanitizers: { type: 'array', items: riskSignalSummary },
        localFlows: { type: 'array', items: riskLocalFlowSummary }
      },
      additionalProperties: true
    },
    taintHints: {
      type: 'object',
      required: ['taintedIdentifiers'],
      properties: {
        taintedIdentifiers: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: true
    },
    totals: {
      type: 'object',
      required: ['sources', 'sinks', 'sanitizers', 'localFlows'],
      properties: {
        sources: intId,
        sinks: intId,
        sanitizers: intId,
        localFlows: intId
      },
      additionalProperties: true
    },
    truncated: {
      type: 'object',
      required: ['sources', 'sinks', 'sanitizers', 'localFlows', 'evidence'],
      properties: {
        sources: { type: 'boolean' },
        sinks: { type: 'boolean' },
        sanitizers: { type: 'boolean' },
        localFlows: { type: 'boolean' },
        evidence: { type: 'boolean' }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

const riskFlowRow = {
  type: 'object',
  required: ['schemaVersion', 'flowId', 'source', 'sink', 'path', 'confidence', 'notes'],
  properties: {
    schemaVersion: posInt,
    flowId: { type: 'string', pattern: '^sha1:[0-9a-f]{40}$' },
    source: {
      type: 'object',
      required: ['chunkUid', 'ruleId', 'ruleName', 'ruleType', 'category', 'severity', 'confidence'],
      properties: {
        chunkUid: { type: 'string' },
        ruleId: { type: 'string' },
        ruleName: { type: 'string' },
        ruleType: { type: 'string' },
        category: nullableString,
        severity: nullableString,
        confidence: { type: ['number', 'null'] }
      },
      additionalProperties: true
    },
    sink: {
      type: 'object',
      required: ['chunkUid', 'ruleId', 'ruleName', 'ruleType', 'category', 'severity', 'confidence'],
      properties: {
        chunkUid: { type: 'string' },
        ruleId: { type: 'string' },
        ruleName: { type: 'string' },
        ruleType: { type: 'string' },
        category: nullableString,
        severity: nullableString,
        confidence: { type: ['number', 'null'] }
      },
      additionalProperties: true
    },
    path: {
      type: 'object',
      required: ['chunkUids', 'callSiteIdsByStep', 'watchByStep'],
      properties: {
        chunkUids: { type: 'array', items: { type: 'string' } },
        callSiteIdsByStep: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } }
        },
        watchByStep: {
          type: 'array',
          items: riskFlowWatchStep
        }
      },
      additionalProperties: true
    },
    confidence: { type: 'number' },
    notes: {
      type: 'object',
      required: ['strictness', 'sanitizerPolicy', 'hopCount', 'sanitizerBarriersHit', 'capsHit'],
      properties: {
        strictness: { type: 'string' },
        sanitizerPolicy: { type: 'string' },
        hopCount: intId,
        sanitizerBarriersHit: intId,
        capsHit: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

const riskPartialFlowBlockedExpansion = {
  type: 'object',
  required: ['reason'],
  properties: {
    targetChunkUid: nullableString,
    reason: { type: 'string' },
    callSiteIds: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: true
};

const riskPartialFlowRow = {
  type: 'object',
  required: ['schemaVersion', 'partialFlowId', 'source', 'frontier', 'path', 'confidence', 'notes'],
  properties: {
    schemaVersion: posInt,
    partialFlowId: { type: 'string', pattern: '^sha1:[0-9a-f]{40}$' },
    source: riskFlowRow.properties.source,
    frontier: {
      type: 'object',
      required: ['chunkUid', 'terminalReason', 'blockedExpansions'],
      properties: {
        chunkUid: { type: 'string' },
        terminalReason: { type: 'string' },
        blockedExpansions: {
          type: 'array',
          items: riskPartialFlowBlockedExpansion
        }
      },
      additionalProperties: true
    },
    path: riskFlowRow.properties.path,
    confidence: { type: 'number' },
    notes: {
      type: 'object',
      required: ['strictness', 'sanitizerPolicy', 'hopCount', 'sanitizerBarriersHit', 'capsHit', 'terminalReason'],
      properties: {
        strictness: { type: 'string' },
        sanitizerPolicy: { type: 'string' },
        hopCount: intId,
        sanitizerBarriersHit: intId,
        capsHit: { type: 'array', items: { type: 'string' } },
        terminalReason: { type: 'string' }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};

const riskInterproceduralStats = {
  type: 'object',
  required: [
    'schemaVersion',
    'generatedAt',
    'mode',
    'status',
    'effectiveConfig',
    'counts',
    'callSiteSampling',
    'capsHit',
    'timingMs'
  ],
  properties: {
    schemaVersion: posInt,
    generatedAt: { type: 'string' },
    mode: { type: 'string' },
    status: { type: 'string' },
    reason: nullableString,
    effectiveConfig: { type: 'object', additionalProperties: true },
    provenance: {
      type: ['object', 'null'],
      properties: {
        indexSignature: nullableString,
        indexCompatKey: nullableString,
        ruleBundle: {
          type: ['object', 'null'],
          properties: {
            version: nullableString,
            fingerprint: nullableString,
            roleModel: {
              type: ['object', 'null'],
              properties: {
                version: nullableString,
                directRoles: { type: 'array', items: { type: 'string' } },
                propagatorLikeRoles: { type: 'array', items: { type: 'string' } },
                propagatorLikeEncoding: nullableString
              },
              additionalProperties: false
            },
            provenance: { type: ['object', 'null'], additionalProperties: true }
          },
          additionalProperties: false
        },
        effectiveConfigFingerprint: nullableString
      },
      additionalProperties: false
    },
    counts: { type: 'object', additionalProperties: true },
    callSiteSampling: { type: 'object', additionalProperties: true },
    capsHit: { type: 'array', items: { type: 'string' } },
    timingMs: { type: 'object', additionalProperties: true },
    artifacts: { type: 'object', additionalProperties: true },
    droppedRecords: { type: 'array', items: { type: 'object' } }
  },
  additionalProperties: true
};

export const RISK_ARTIFACT_SCHEMA_DEFS = {
  risk_summaries: {
    type: 'array',
    items: riskSummaryRow
  },
  risk_flows: {
    type: 'array',
    items: riskFlowRow
  },
  risk_partial_flows: {
    type: 'array',
    items: riskPartialFlowRow
  },
  risk_interprocedural_stats: riskInterproceduralStats
};
