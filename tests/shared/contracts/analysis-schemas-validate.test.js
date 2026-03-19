#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  validateGraphContextPack,
  validateGraphImpact,
  validateRiskDelta,
  validateCompositeContextPack,
  validateApiContracts,
  validateArchitectureReport,
  validateSuggestTests
} from '../../../src/contracts/validators/analysis.js';
import {
  CONTEXT_PACK_RISK_CONTRACT_VERSION,
  CONTEXT_PACK_RISK_SCHEMA_VERSION
} from '../../../src/contracts/context-pack-risk-contract.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const provenance = {
  generatedAt: '2026-02-01T00:00:00Z',
  indexSignature: 'sig-0001',
  capsUsed: {}
};

const seed = { type: 'chunk', chunkUid: 'chunk-1' };

const graphContextPack = {
  version: '1.0.0',
  seed,
  provenance,
  nodes: [],
  edges: []
};

const graphImpact = {
  version: '1.0.0',
  seed,
  direction: 'upstream',
  depth: 0,
  impacted: [],
  provenance
};

const compositeContextPack = {
  version: '1.0.0',
  seed,
  provenance,
  primary: {
    ref: seed,
    file: 'src/app.js',
    excerpt: 'const alpha = 1;',
    excerptHash: 'sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  },
  risk: {
    version: CONTEXT_PACK_RISK_SCHEMA_VERSION,
    contractVersion: CONTEXT_PACK_RISK_CONTRACT_VERSION,
    status: 'ok',
    reason: null,
    anchor: {
      kind: 'source',
      chunkUid: 'chunk-1',
      ref: seed,
      alternateCount: 0,
      alternates: []
    },
    summary: {
      chunkUid: 'chunk-1',
      file: 'src/app.js',
      languageId: 'javascript',
      symbol: null,
      totals: {
        sources: 1,
        sinks: 1,
        sanitizers: 0,
        localFlows: 0
      },
      truncated: {
        sources: false,
        sinks: false,
        sanitizers: false,
        localFlows: false,
        evidence: false
      },
      topCategories: [],
      topTags: [],
      previewFlowIds: ['sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
    },
    stats: {
      status: 'ok',
      reason: null,
      summaryOnly: false,
      flowsEmitted: 1,
      partialFlowsEmitted: 1,
      summariesEmitted: 1,
      uniqueCallSitesReferenced: 1,
      capsHit: [],
      callSiteSampling: {
        strategy: 'firstN'
      },
      effectiveConfig: {
        enabled: true,
        summaryOnly: false
      }
    },
    analysisStatus: {
      requested: true,
      status: 'ok',
      reason: null,
      degraded: false,
      summaryOnly: false,
      code: 'ok',
      strictFailure: false,
      artifactStatus: {
        stats: 'present',
        summaries: 'present',
        flows: 'present',
        partialFlows: 'present',
        callSites: 'present'
      },
      degradedReasons: []
    },
    caps: {
      maxFlows: 5,
      maxPartialFlows: 3,
      maxStepsPerFlow: 8,
      maxCallSitesPerStep: 3,
      maxBytes: 24576,
      maxTokens: 2048,
      maxPartialBytes: 4096,
      maxPartialTokens: 512,
      hits: [],
      observed: {
        candidateFlows: 1,
        selectedFlows: 1,
        selectedPartialFlows: 1,
        omittedPartialFlows: 0,
        omittedFlows: 0,
        emittedSteps: 1,
        omittedSteps: 0,
        omittedCallSites: 0,
        bytes: 100,
        tokens: 10
      }
    },
    truncation: [],
    provenance: {
      manifestVersion: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      compatibilityKey: 'compat-0001',
      indexSignature: 'sig-0001',
      indexCompatKey: 'compat-0001',
      mode: 'code',
      generatedAt: '2026-02-01T00:00:00Z',
      ruleBundle: {
        version: '1.0.0',
        fingerprint: 'sha1:cccccccccccccccccccccccccccccccccccccccc',
        provenance: {
          defaults: true,
          sourcePath: null
        }
      },
      effectiveConfigFingerprint: 'sha1:dddddddddddddddddddddddddddddddddddddddd',
      artifacts: {
        stats: 'present',
        summaries: 'present',
        flows: 'present',
        callSites: 'present'
      },
      artifactRefs: {
        stats: {
          name: 'risk_interprocedural_stats',
          format: 'json',
          sharded: false,
          entrypoint: 'risk_interprocedural_stats.json',
          totalEntries: 1
        },
        summaries: {
          name: 'risk_summaries',
          format: 'jsonl',
          sharded: false,
          entrypoint: 'risk_summaries.jsonl',
          totalEntries: 1
        },
        flows: {
          name: 'risk_flows',
          format: 'jsonl',
          sharded: false,
          entrypoint: 'risk_flows.jsonl',
          totalEntries: 1
        },
        partialFlows: {
          name: 'risk_partial_flows',
          format: 'jsonl',
          sharded: false,
          entrypoint: 'risk_partial_flows.jsonl',
          totalEntries: 1
        },
        callSites: {
          name: 'call_sites',
          format: 'jsonl',
          sharded: false,
          entrypoint: 'call_sites.jsonl',
          totalEntries: 1
        }
      }
    },
    flows: [
      {
        flowId: 'sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        rank: 1,
        source: {
          chunkUid: 'chunk-1',
          ruleId: 'source.req.body',
          ruleName: 'req.body',
          ruleType: 'source',
          category: 'input',
          severity: 'low',
          confidence: 0.6
        },
        sink: {
          chunkUid: 'chunk-2',
          ruleId: 'sink.sql.query',
          ruleName: 'sql.query',
          ruleType: 'sink',
          category: 'sql',
          severity: 'high',
          confidence: 0.9
        },
        path: {
          nodes: [{ type: 'chunk', chunkUid: 'chunk-1' }],
          truncatedSteps: 0,
          watchByStep: [{
            taintIn: ['req.body'],
            taintOut: ['input'],
            propagatedArgIndices: [0],
            boundParams: ['input'],
            calleeNormalized: 'query',
            semanticIds: ['sem.callback.register-handler-payload'],
            semanticKinds: ['callback'],
            sanitizerPolicy: 'terminate',
            sanitizerBarrierApplied: false,
            sanitizerBarriersBefore: 0,
            sanitizerBarriersAfter: 0,
            confidenceBefore: 0.6,
            confidenceAfter: 0.51,
            confidenceDelta: -0.09
          }]
        },
        evidence: {
          callSitesByStep: []
        },
        confidence: 0.8,
        notes: {
          hopCount: 1,
          strictness: 'conservative',
          sanitizerPolicy: 'terminate',
          sanitizerBarriersHit: 0
        },
        score: {
          seedRelevance: 3,
          severity: 4,
          confidence: 0.8,
          hopCount: 1
        }
      }
    ],
    partialFlows: [
      {
        partialFlowId: 'sha1:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        source: {
          chunkUid: 'chunk-1',
          ruleId: 'source.req.body',
          ruleName: 'req.body',
          ruleType: 'source',
          category: 'input',
          severity: null,
          confidence: 0.6
        },
        frontier: {
          chunkUid: 'chunk-2',
          terminalReason: 'maxDepth',
          blockedExpansions: []
        },
        path: {
          nodes: [
            { type: 'chunk', chunkUid: 'chunk-1' },
            { type: 'chunk', chunkUid: 'chunk-2' }
          ],
          callSiteIdsByStep: [[]],
          watchByStep: [{
            taintIn: ['req.body'],
            taintOut: ['input'],
            propagatedArgIndices: [0],
            boundParams: ['input'],
            calleeNormalized: 'query',
            semanticIds: ['sem.callback.register-handler-payload'],
            semanticKinds: ['callback'],
            sanitizerPolicy: 'terminate',
            sanitizerBarrierApplied: false,
            sanitizerBarriersBefore: 0,
            sanitizerBarriersAfter: 0,
            confidenceBefore: 0.6,
            confidenceAfter: 0.51,
            confidenceDelta: -0.09
          }]
        },
        confidence: 0.7,
        notes: {
          strictness: 'conservative',
          sanitizerPolicy: 'terminate',
          hopCount: 1,
          sanitizerBarriersHit: 0,
          terminalReason: 'maxDepth',
          capsHit: ['maxDepth']
        }
      }
    ],
    degraded: false
  }
};

const riskDelta = {
  version: '1.0.0',
  seed,
  filters: {
    rule: [],
    category: [],
    severity: [],
    tag: [],
    source: [],
    sink: [],
    sourceRule: [],
    sinkRule: [],
    flowId: []
  },
  includePartialFlows: true,
  from: {
    requestedRef: 'snap:snap-old',
    canonical: 'snap:snap-old',
    identity: { type: 'snapshot', snapshotId: 'snap-old' },
    snapshot: null,
    warnings: [],
    seedStatus: 'resolved',
    target: {
      chunkUid: 'chunk-1',
      file: 'src/app.js',
      name: 'alpha',
      kind: 'function'
    },
    summary: compositeContextPack.risk.summary,
    stats: compositeContextPack.risk.stats,
    provenance: {
      manifestVersion: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      indexIdentity: { type: 'snapshot', snapshotId: 'snap-old' },
      ruleBundle: compositeContextPack.risk.provenance.ruleBundle,
      artifacts: compositeContextPack.risk.provenance.artifacts
    },
    flows: compositeContextPack.risk.flows,
    partialFlows: compositeContextPack.risk.partialFlows
  },
  to: {
    requestedRef: 'snap:snap-new',
    canonical: 'snap:snap-new',
    identity: { type: 'snapshot', snapshotId: 'snap-new' },
    snapshot: null,
    warnings: [],
    seedStatus: 'resolved',
    target: {
      chunkUid: 'chunk-1',
      file: 'src/app.js',
      name: 'alpha',
      kind: 'function'
    },
    summary: compositeContextPack.risk.summary,
    stats: compositeContextPack.risk.stats,
    provenance: {
      manifestVersion: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      indexIdentity: { type: 'snapshot', snapshotId: 'snap-new' },
      ruleBundle: compositeContextPack.risk.provenance.ruleBundle,
      artifacts: compositeContextPack.risk.provenance.artifacts
    },
    flows: compositeContextPack.risk.flows,
    partialFlows: compositeContextPack.risk.partialFlows
  },
  summary: {
    flowCounts: {
      from: 1,
      to: 1,
      added: 0,
      removed: 0,
      changed: 1,
      unchanged: 0
    },
    partialFlowCounts: {
      from: 1,
      to: 1,
      added: 0,
      removed: 0,
      changed: 1,
      unchanged: 0
    }
  },
  deltas: {
    flows: {
      added: [],
      removed: [],
      changed: [{
        flowId: compositeContextPack.risk.flows[0].flowId,
        changedFields: ['confidence'],
        beforeFingerprint: 'sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        afterFingerprint: 'sha1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        before: compositeContextPack.risk.flows[0],
        after: { ...compositeContextPack.risk.flows[0], confidence: 0.9 }
      }],
      unchangedCount: 0
    },
    partialFlows: {
      added: [],
      removed: [],
      changed: [{
        partialFlowId: compositeContextPack.risk.partialFlows[0].partialFlowId,
        changedFields: ['confidence'],
        beforeFingerprint: 'sha1:cccccccccccccccccccccccccccccccccccccccc',
        afterFingerprint: 'sha1:dddddddddddddddddddddddddddddddddddddddd',
        before: compositeContextPack.risk.partialFlows[0],
        after: { ...compositeContextPack.risk.partialFlows[0], confidence: 0.8 }
      }],
      unchangedCount: 0
    }
  }
};

const apiContracts = {
  version: '1.0.0',
  provenance,
  options: {
    onlyExports: true,
    failOnWarn: false,
    caps: {
      maxSymbols: 10,
      maxCallsPerSymbol: 5,
      maxWarnings: 5
    }
  },
  symbols: []
};

const architectureReport = {
  version: '1.0.0',
  provenance,
  rules: [],
  violations: []
};

const suggestTests = {
  version: '1.0.0',
  provenance,
  changed: [],
  suggestions: []
};

const validators = [
  ['graph context pack', validateGraphContextPack, graphContextPack],
  ['graph impact', validateGraphImpact, graphImpact],
  ['risk delta', validateRiskDelta, riskDelta],
  ['composite context pack', validateCompositeContextPack, compositeContextPack],
  ['api contracts', validateApiContracts, apiContracts],
  ['architecture report', validateArchitectureReport, architectureReport],
  ['suggest tests', validateSuggestTests, suggestTests]
];

for (const [label, validator, payload] of validators) {
  const result = validator(payload);
  assert.equal(result.ok, true, `expected ${label} to validate: ${result.errors.join(', ')}`);
}

console.log('analysis schema validation tests passed');
