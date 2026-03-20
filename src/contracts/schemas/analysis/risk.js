import {
  nullableNumber,
  nullableString,
  riskWatchSemanticsSchema,
  semverString
} from './primitives.js';
import { nodeRefSchema, seedRefSchema } from './graph.js';

export const typeFactSchema = {
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

const riskTopCategorySchema = {
  type: 'object',
  required: ['category', 'count'],
  properties: {
    category: { type: 'string' },
    count: { type: 'number' }
  },
  additionalProperties: false
};

const riskTopTagSchema = {
  type: 'object',
  required: ['tag', 'count'],
  properties: {
    tag: { type: 'string' },
    count: { type: 'number' }
  },
  additionalProperties: false
};

export const riskSummarySchema = {
  type: ['object', 'null'],
  properties: {
    chunkUid: nullableString,
    file: nullableString,
    languageId: nullableString,
    repo: {
      type: ['object', 'null'],
      properties: {
        repoId: nullableString,
        alias: nullableString,
        priority: nullableNumber,
        workspaceId: nullableString,
        base: { type: ['boolean', 'null'] }
      },
      additionalProperties: false
    },
    symbol: {
      type: ['object', 'null'],
      properties: {
        name: nullableString,
        kind: nullableString,
        signature: nullableString
      },
      additionalProperties: false
    },
    totals: {
      type: ['object', 'null'],
      properties: {
        sources: nullableNumber,
        sinks: nullableNumber,
        sanitizers: nullableNumber,
        localFlows: nullableNumber
      },
      additionalProperties: false
    },
    truncated: {
      type: ['object', 'null'],
      properties: {
        sources: { type: ['boolean', 'null'] },
        sinks: { type: ['boolean', 'null'] },
        sanitizers: { type: ['boolean', 'null'] },
        localFlows: { type: ['boolean', 'null'] },
        evidence: { type: ['boolean', 'null'] }
      },
      additionalProperties: false
    },
    ruleRoles: {
      type: ['object', 'null'],
      properties: {
        sources: nullableNumber,
        sinks: nullableNumber,
        sanitizers: nullableNumber
      },
      additionalProperties: false
    },
    propagatorLikeRoles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: nullableString,
          count: nullableNumber
        },
        additionalProperties: false
      }
    },
    topCategories: { type: 'array', items: riskTopCategorySchema },
    topTags: { type: 'array', items: riskTopTagSchema },
    previewFlowIds: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
};

const riskRepoProvenanceSchema = {
  type: ['object', 'null'],
  properties: {
    repoId: nullableString,
    alias: nullableString,
    priority: nullableNumber,
    workspaceId: nullableString,
    base: { type: ['boolean', 'null'] }
  },
  additionalProperties: false
};

const riskSourceSinkSchema = {
  type: ['object', 'null'],
  properties: {
    chunkUid: nullableString,
    ruleId: nullableString,
    ruleName: nullableString,
    ruleType: nullableString,
    ruleRole: nullableString,
    category: nullableString,
    severity: nullableString,
    confidence: nullableNumber,
    tags: { type: 'array', items: { type: 'string' } },
    repo: riskRepoProvenanceSchema
  },
  additionalProperties: false
};

export const riskFiltersSchema = {
  type: ['object', 'null'],
  properties: {
    rule: { type: 'array', items: { type: 'string' } },
    category: { type: 'array', items: { type: 'string' } },
    severity: { type: 'array', items: { type: 'string' } },
    tag: { type: 'array', items: { type: 'string' } },
    source: { type: 'array', items: { type: 'string' } },
    sink: { type: 'array', items: { type: 'string' } },
    sourceRule: { type: 'array', items: { type: 'string' } },
    sinkRule: { type: 'array', items: { type: 'string' } },
    flowId: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
};

const riskCallSiteEvidenceSchema = {
  type: 'object',
  required: ['callSiteId', 'details'],
  properties: {
    callSiteId: nullableString,
    details: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: false
};

const riskFlowNotesSchema = {
  type: ['object', 'null'],
  properties: {
    strictness: nullableString,
    sanitizerPolicy: nullableString,
    hopCount: nullableNumber,
    sanitizerBarriersHit: nullableNumber,
    capsHit: { type: 'array', items: { type: 'string' } },
    terminalReason: nullableString
  },
  additionalProperties: false
};

export const riskFlowSummarySchema = {
  type: 'object',
  required: ['rank', 'path', 'score'],
  properties: {
    rank: nullableNumber,
    flowId: nullableString,
    repo: riskRepoProvenanceSchema,
    source: riskSourceSinkSchema,
    sink: riskSourceSinkSchema,
    category: nullableString,
    severity: nullableString,
    confidence: nullableNumber,
    score: {
      type: ['object', 'null'],
      properties: {
        seedRelevance: nullableNumber,
        severity: nullableNumber,
        confidence: nullableNumber,
        hopCount: nullableNumber
      },
      additionalProperties: false
    },
    path: {
      type: 'object',
      required: ['nodes'],
      properties: {
        nodes: { type: 'array', items: nodeRefSchema },
        stepCount: nullableNumber,
        truncatedSteps: nullableNumber,
        callSiteIdsByStep: { type: ['array', 'null'], items: { type: 'array', items: { type: 'string' } } },
        watchByStep: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            properties: {
              taintIn: { type: 'array', items: { type: 'string' } },
              taintOut: { type: 'array', items: { type: 'string' } },
              propagatedArgIndices: { type: 'array', items: nullableNumber },
              boundParams: { type: 'array', items: { type: 'string' } },
              calleeNormalized: nullableString,
              ...riskWatchSemanticsSchema,
              sanitizerPolicy: nullableString,
              sanitizerBarrierApplied: { type: ['boolean', 'null'] },
              sanitizerBarriersBefore: nullableNumber,
              sanitizerBarriersAfter: nullableNumber,
              confidenceBefore: nullableNumber,
              confidenceAfter: nullableNumber,
              confidenceDelta: nullableNumber
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    evidence: {
      type: ['object', 'null'],
      properties: {
        sourceRuleId: nullableString,
        sinkRuleId: nullableString,
        callSitesByStep: {
          type: ['array', 'null'],
          items: {
            type: 'array',
            items: riskCallSiteEvidenceSchema
          }
        }
      },
      additionalProperties: false
    },
    notes: riskFlowNotesSchema
  },
  additionalProperties: false
};

const riskPartialBlockedExpansionSchema = {
  type: 'object',
  properties: {
    targetChunkUid: nullableString,
    reason: nullableString,
    callSiteIds: { type: 'array', items: { type: 'string' } },
    repo: riskRepoProvenanceSchema
  },
  additionalProperties: false
};

export const riskPartialFlowSummarySchema = {
  type: 'object',
  required: ['path'],
  properties: {
    rank: nullableNumber,
    partialFlowId: nullableString,
    repo: riskRepoProvenanceSchema,
    source: riskSourceSinkSchema,
    confidence: nullableNumber,
    score: {
      type: ['object', 'null'],
      properties: {
        seedRelevance: nullableNumber,
        confidence: nullableNumber,
        hopCount: nullableNumber
      },
      additionalProperties: false
    },
    frontier: {
      type: ['object', 'null'],
      properties: {
        chunkUid: nullableString,
        terminalReason: nullableString,
        repo: riskRepoProvenanceSchema,
        blockedExpansions: {
          type: 'array',
          items: riskPartialBlockedExpansionSchema
        }
      },
      additionalProperties: false
    },
    path: {
      type: 'object',
      required: ['nodes'],
      properties: {
        nodes: { type: 'array', items: nodeRefSchema },
        labels: { type: ['array', 'null'], items: { type: 'string' } },
        stepCount: nullableNumber,
        truncatedSteps: nullableNumber,
        callSiteIdsByStep: { type: ['array', 'null'], items: { type: 'array', items: { type: 'string' } } },
        watchByStep: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            properties: {
              taintIn: { type: 'array', items: { type: 'string' } },
              taintOut: { type: 'array', items: { type: 'string' } },
              propagatedArgIndices: { type: 'array', items: nullableNumber },
              boundParams: { type: 'array', items: { type: 'string' } },
              calleeNormalized: nullableString,
              ...riskWatchSemanticsSchema,
              sanitizerPolicy: nullableString,
              sanitizerBarrierApplied: { type: ['boolean', 'null'] },
              sanitizerBarriersBefore: nullableNumber,
              sanitizerBarriersAfter: nullableNumber,
              confidenceBefore: nullableNumber,
              confidenceAfter: nullableNumber,
              confidenceDelta: nullableNumber
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    evidence: {
      type: ['object', 'null'],
      properties: {
        callSitesByStep: {
          type: ['array', 'null'],
          items: {
            type: 'array',
            items: riskCallSiteEvidenceSchema
          }
        }
      },
      additionalProperties: false
    },
    notes: riskFlowNotesSchema
  },
  additionalProperties: false
};

export const riskFederationSchema = {
  type: ['object', 'null'],
  properties: {
    enabled: { type: ['boolean', 'null'] },
    workspace: {
      type: ['object', 'null'],
      properties: {
        workspaceId: nullableString,
        name: nullableString,
        workspacePath: nullableString
      },
      additionalProperties: false
    },
    selection: {
      type: ['object', 'null'],
      properties: {
        selectedRepoIds: { type: 'array', items: { type: 'string' } },
        selectedRepos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              repoId: nullableString,
              alias: nullableString,
              priority: nullableNumber,
              enabled: { type: ['boolean', 'null'] },
              base: { type: ['boolean', 'null'] }
            },
            additionalProperties: false
          }
        },
        explicitSelects: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        repoFilter: { type: 'array', items: { type: 'string' } },
        includeDisabled: { type: ['boolean', 'null'] },
        maxRepos: nullableNumber,
        bounded: { type: ['boolean', 'null'] }
      },
      additionalProperties: false
    },
    skippedRepos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          repoId: nullableString,
          alias: nullableString,
          reason: nullableString
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
};

export const riskAnalysisStatusSchema = {
  type: ['object', 'null'],
  properties: {
    requested: { type: ['boolean', 'null'] },
    status: nullableString,
    reason: nullableString,
    degraded: { type: ['boolean', 'null'] },
    summaryOnly: { type: ['boolean', 'null'] },
    code: nullableString,
    strictFailure: { type: ['boolean', 'null'] },
    artifactStatus: {
      type: ['object', 'null'],
      properties: {
        stats: nullableString,
        summaries: nullableString,
        flows: nullableString,
        partialFlows: nullableString,
        callSites: nullableString
      },
      additionalProperties: false
    },
    degradedReasons: { type: 'array', items: { type: 'string' } },
    flowsEmitted: nullableNumber,
    partialFlowsEmitted: nullableNumber,
    uniqueCallSitesReferenced: nullableNumber,
    capsHit: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
};

export const riskAnchorSchema = {
  type: ['object', 'null'],
  properties: {
    kind: nullableString,
    chunkUid: nullableString,
    ref: { type: ['object', 'null'], additionalProperties: true },
    flowId: nullableString,
    alternateCount: nullableNumber,
    alternates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: nullableString,
          chunkUid: nullableString,
          ref: { type: ['object', 'null'], additionalProperties: true },
          flowId: nullableString
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
};

export const riskCapsSchema = {
  type: ['object', 'null'],
  properties: {
    maxFlows: nullableNumber,
    maxStepsPerFlow: nullableNumber,
    maxCallSitesPerStep: nullableNumber,
    maxBytes: nullableNumber,
    maxTokens: nullableNumber,
    maxPartialFlows: nullableNumber,
    maxPartialBytes: nullableNumber,
    maxPartialTokens: nullableNumber,
    maxCallSiteExcerptBytes: nullableNumber,
    maxCallSiteExcerptTokens: nullableNumber,
    hits: { type: 'array', items: { type: 'string' } },
    observed: {
      type: ['object', 'null'],
      properties: {
        candidateFlows: nullableNumber,
        selectedFlows: nullableNumber,
        omittedFlows: nullableNumber,
        candidatePartialFlows: nullableNumber,
        selectedPartialFlows: nullableNumber,
        omittedPartialFlows: nullableNumber,
        emittedSteps: nullableNumber,
        omittedSteps: nullableNumber,
        omittedCallSites: nullableNumber,
        bytes: nullableNumber,
        tokens: nullableNumber,
        partialBytes: nullableNumber,
        partialTokens: nullableNumber,
        truncatedCallSiteExcerpts: nullableNumber,
        truncatedCallSiteExcerptBytes: nullableNumber,
        truncatedCallSiteExcerptTokens: nullableNumber
      },
      additionalProperties: false
    },
    configured: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: false
};

export const riskProvenanceSchema = {
  type: ['object', 'null'],
  properties: {
    manifestVersion: nullableNumber,
    artifactSurfaceVersion: nullableString,
    compatibilityKey: nullableString,
    indexSignature: nullableString,
    indexCompatKey: nullableString,
    mode: nullableString,
    generatedAt: nullableString,
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
        provenance: {
          type: ['object', 'null'],
          properties: {
            defaults: { type: ['boolean', 'null'] },
            sourcePath: nullableString
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    },
    effectiveConfigFingerprint: nullableString,
    artifacts: {
      type: ['object', 'null'],
      properties: {
        stats: nullableString,
        summaries: nullableString,
        flows: nullableString,
        partialFlows: nullableString,
        callSites: nullableString
      },
      additionalProperties: false
    },
    artifactRefs: {
      type: ['object', 'null'],
      properties: {
        stats: { type: ['object', 'null'], additionalProperties: true },
        summaries: { type: ['object', 'null'], additionalProperties: true },
        flows: { type: ['object', 'null'], additionalProperties: true },
        partialFlows: { type: ['object', 'null'], additionalProperties: true },
        callSites: { type: ['object', 'null'], additionalProperties: true }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

export const riskStatsSchema = {
  type: ['object', 'null'],
  properties: {
    status: nullableString,
    reason: nullableString,
    summaryOnly: { type: ['boolean', 'null'] },
    flowsEmitted: nullableNumber,
    partialFlowsEmitted: nullableNumber,
    summariesEmitted: nullableNumber,
    uniqueCallSitesReferenced: nullableNumber,
    capsHit: { type: 'array', items: { type: 'string' } },
    callSiteSampling: { type: ['object', 'null'], additionalProperties: true },
    effectiveConfig: { type: ['object', 'null'], additionalProperties: true }
  },
  additionalProperties: false
};

export const riskGuidanceSchema = {
  type: ['object', 'null'],
  properties: {
    ranking: {
      type: ['object', 'null'],
      properties: {
        callers: nullableString,
        symbols: nullableString,
        tests: nullableString
      },
      additionalProperties: false
    },
    caps: {
      type: ['object', 'null'],
      properties: {
        maxCallers: nullableNumber,
        maxSymbols: nullableNumber,
        maxTests: nullableNumber,
        hits: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    },
    callers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          chunkUid: nullableString,
          file: nullableString,
          name: nullableString,
          kind: nullableString,
          score: nullableNumber,
          coveredTargets: { type: 'array', items: { type: 'string' } },
          reason: nullableString
        },
        additionalProperties: false
      }
    },
    symbols: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbolId: nullableString,
          chunkUid: nullableString,
          path: nullableString,
          name: nullableString,
          kind: nullableString,
          score: nullableNumber,
          coveredChunks: { type: 'array', items: { type: 'string' } },
          reason: nullableString
        },
        additionalProperties: false
      }
    },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          testPath: nullableString,
          score: nullableNumber,
          reason: nullableString,
          witnessPath: { type: ['object', 'null'], additionalProperties: true }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
};

export const riskSupportSchema = {
  type: ['object', 'null'],
  properties: {
    registry: {
      type: ['object', 'null'],
      properties: {
        loaded: { type: ['boolean', 'null'] },
        languageKey: nullableString,
        frameworkKey: nullableString
      },
      additionalProperties: false
    },
    language: {
      type: ['object', 'null'],
      properties: {
        languageId: nullableString,
        state: nullableString,
        source: nullableString,
        capabilities: {
          type: ['object', 'null'],
          properties: {
            riskLocal: nullableString,
            riskInterprocedural: nullableString
          },
          additionalProperties: false
        },
        unsupportedConstructs: {
          type: ['object', 'null'],
          properties: {
            sources: { type: 'array', items: { type: 'string' } },
            sinks: { type: 'array', items: { type: 'string' } },
            sanitizers: { type: 'array', items: { type: 'string' } }
          },
          additionalProperties: false
        },
        diagnostics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: nullableString,
              source: nullableString,
              reasonCode: nullableString,
              detail: nullableString
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    framework: {
      type: ['object', 'null'],
      properties: {
        frameworkId: nullableString,
        state: nullableString,
        source: nullableString,
        appliesToLanguage: { type: ['boolean', 'null'] },
        confidence: nullableString,
        signals: { type: 'array', items: { type: 'string' } },
        diagnostics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: nullableString,
              source: nullableString,
              detail: nullableString
            },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    downgradedReasoningPaths: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: nullableString,
          scope: nullableString,
          message: nullableString
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
};

const riskDeltaSideSchema = {
  type: 'object',
  required: ['requestedRef', 'canonical', 'seedStatus', 'flows', 'partialFlows'],
  properties: {
    requestedRef: { type: 'string' },
    canonical: { type: 'string' },
    identity: { type: ['object', 'null'], additionalProperties: true },
    snapshot: { type: ['object', 'null'], additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } },
    seedStatus: { type: 'string', enum: ['resolved', 'missing'] },
    target: {
      type: ['object', 'null'],
      properties: {
        chunkUid: nullableString,
        file: nullableString,
        name: nullableString,
        kind: nullableString
      },
      additionalProperties: false
    },
    summary: riskSummarySchema,
    stats: riskStatsSchema,
    provenance: {
      type: ['object', 'null'],
      properties: {
        manifestVersion: nullableNumber,
        artifactSurfaceVersion: nullableString,
        indexIdentity: { type: ['object', 'null'], additionalProperties: true },
        ruleBundle: { type: ['object', 'null'], additionalProperties: true },
        artifacts: { type: ['object', 'null'], additionalProperties: true }
      },
      additionalProperties: false
    },
    flows: { type: 'array', items: riskFlowSummarySchema },
    partialFlows: { type: 'array', items: riskPartialFlowSummarySchema }
  },
  additionalProperties: false
};

export const RISK_DELTA_SCHEMA = {
  type: 'object',
  required: ['version', 'seed', 'filters', 'includePartialFlows', 'from', 'to', 'summary', 'deltas'],
  properties: {
    version: semverString,
    seed: seedRefSchema,
    filters: riskFiltersSchema,
    includePartialFlows: { type: 'boolean' },
    from: riskDeltaSideSchema,
    to: riskDeltaSideSchema,
    summary: {
      type: 'object',
      required: ['flowCounts', 'partialFlowCounts'],
      properties: {
        flowCounts: {
          type: 'object',
          required: ['from', 'to', 'added', 'removed', 'changed', 'unchanged'],
          properties: {
            from: nullableNumber,
            to: nullableNumber,
            added: nullableNumber,
            removed: nullableNumber,
            changed: nullableNumber,
            unchanged: nullableNumber
          },
          additionalProperties: false
        },
        partialFlowCounts: {
          type: 'object',
          required: ['from', 'to', 'added', 'removed', 'changed', 'unchanged'],
          properties: {
            from: nullableNumber,
            to: nullableNumber,
            added: nullableNumber,
            removed: nullableNumber,
            changed: nullableNumber,
            unchanged: nullableNumber
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    },
    deltas: {
      type: 'object',
      required: ['flows', 'partialFlows'],
      properties: {
        flows: {
          type: 'object',
          required: ['added', 'removed', 'changed', 'unchangedCount'],
          properties: {
            added: { type: 'array', items: riskFlowSummarySchema },
            removed: { type: 'array', items: riskFlowSummarySchema },
            changed: {
              type: 'array',
              items: {
                type: 'object',
                required: ['flowId', 'changedFields', 'beforeFingerprint', 'afterFingerprint', 'before', 'after'],
                properties: {
                  flowId: nullableString,
                  changedFields: { type: 'array', items: { type: 'string' } },
                  beforeFingerprint: nullableString,
                  afterFingerprint: nullableString,
                  before: riskFlowSummarySchema,
                  after: riskFlowSummarySchema
                },
                additionalProperties: false
              }
            },
            unchangedCount: nullableNumber
          },
          additionalProperties: false
        },
        partialFlows: {
          type: 'object',
          required: ['added', 'removed', 'changed', 'unchangedCount'],
          properties: {
            added: { type: 'array', items: riskPartialFlowSummarySchema },
            removed: { type: 'array', items: riskPartialFlowSummarySchema },
            changed: {
              type: 'array',
              items: {
                type: 'object',
                required: ['partialFlowId', 'changedFields', 'beforeFingerprint', 'afterFingerprint', 'before', 'after'],
                properties: {
                  partialFlowId: nullableString,
                  changedFields: { type: 'array', items: { type: 'string' } },
                  beforeFingerprint: nullableString,
                  afterFingerprint: nullableString,
                  before: riskPartialFlowSummarySchema,
                  after: riskPartialFlowSummarySchema
                },
                additionalProperties: false
              }
            },
            unchangedCount: nullableNumber
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};
