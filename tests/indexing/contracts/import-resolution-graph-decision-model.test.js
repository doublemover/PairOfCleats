#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateArtifact } from '../../../src/shared/artifact-schemas.js';

const baseGraph = {
  generatedAt: new Date().toISOString(),
  nodes: [
    { id: 'src/main.js', type: 'file' },
    { id: 'src/util.js', type: 'file' }
  ],
  edges: [
    {
      from: 'src/main.js',
      to: 'src/util.js',
      rawSpecifier: './util.js',
      resolvedType: 'relative',
      resolutionState: 'resolved',
      reasonCode: null,
      failureCause: null,
      disposition: null,
      resolverStage: null
    },
    {
      from: 'src/main.js',
      to: null,
      rawSpecifier: './missing.js',
      resolvedType: 'unresolved',
      resolutionState: 'unresolved',
      reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
      failureCause: 'missing_file',
      disposition: 'actionable',
      resolverStage: 'filesystem_probe'
    }
  ],
  warnings: [
    {
      importer: 'src/main.js',
      specifier: './missing.js',
      reason: 'unresolved',
      resolutionState: 'unresolved',
      reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
      failureCause: 'missing_file',
      disposition: 'actionable',
      resolverStage: 'filesystem_probe',
      confidence: 0.9
    }
  ],
  stats: {
    unresolvedByReasonCode: { IMP_U_MISSING_FILE_RELATIVE: 1 },
    unresolvedByFailureCause: { missing_file: 1 },
    unresolvedByDisposition: { actionable: 1 },
    unresolvedByResolverStage: { filesystem_probe: 1 },
    unresolvedActionableByLanguage: { js: 1 },
    unresolvedGateEligible: 1,
    unresolvedActionableGateEligible: 1,
    unresolvedGateEligibleActionableRate: 1,
    unresolvedActionableRate: 1,
    unresolvedParserArtifactRate: 0,
    unresolvedResolverGapRate: 0,
    unresolvedBudgetExhausted: 0,
    unresolvedBudgetExhaustedByType: {},
    resolverFsExistsIndex: {
      enabled: true,
      complete: true,
      indexedCount: 2,
      fileCount: 2,
      truncated: false,
      bloomBits: 4096,
      exactHits: 1,
      negativeSkips: 0,
      unknownFallbacks: 0
    },
    resolverBudgetPolicy: {
      maxFilesystemProbesPerSpecifier: 32,
      maxFallbackCandidatesPerSpecifier: 48,
      maxFallbackDepth: 16,
      adaptiveEnabled: true,
      adaptiveProfile: 'normal',
      adaptiveScale: 1
    },
    resolverPipelineStages: {
      normalize: {
        attempts: 2,
        hits: 2,
        misses: 0,
        elapsedMs: 1.5,
        budgetExhausted: 0,
        degraded: 0
      },
      filesystem_probe: {
        attempts: 1,
        hits: 0,
        misses: 1,
        elapsedMs: 0.5,
        budgetExhausted: 0,
        degraded: 0
      }
    }
  }
};

const baseline = validateArtifact('import_resolution_graph', baseGraph);
assert.equal(baseline.ok, true, `baseline import graph should validate: ${baseline.errors.join('; ')}`);

const invalidResolvedEdge = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  edges: [
    {
      ...baseGraph.edges[0],
      reasonCode: 'IMP_U_UNKNOWN'
    }
  ]
});
assert.equal(invalidResolvedEdge.ok, false, 'resolved edge must not carry unresolved reason code fields');

const invalidUnresolvedEdge = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  edges: [
    {
      ...baseGraph.edges[1],
      disposition: null
    }
  ]
});
assert.equal(invalidUnresolvedEdge.ok, false, 'unresolved edge requires non-null decision fields');

const invalidReasonCodeBucket = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  stats: {
    ...baseGraph.stats,
    unresolvedByReasonCode: {
      IMP_U_MISSING_FILE_RELATIVE: 1,
      NOT_A_REASON_CODE: 2
    }
  }
});
assert.equal(invalidReasonCodeBucket.ok, false, 'unknown reason-code buckets must be rejected');

const invalidLegacyCategoryStats = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  stats: {
    ...baseGraph.stats,
    unresolvedByCategory: { missing_file: 1 }
  }
});
assert.equal(invalidLegacyCategoryStats.ok, false, 'legacy unresolvedByCategory stats must be rejected');

const invalidWarning = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  warnings: [
    {
      ...baseGraph.warnings[0],
      resolverStage: 'not_a_real_stage'
    }
  ]
});
assert.equal(invalidWarning.ok, false, 'warning entries must use known decision-model enums');

const invalidWarningCategoryField = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  warnings: [
    {
      ...baseGraph.warnings[0],
      category: 'missing_file'
    }
  ]
});
assert.equal(invalidWarningCategoryField.ok, false, 'warning entries must reject legacy category field');

const invalidResolverStagePipelineKey = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  stats: {
    ...baseGraph.stats,
    resolverPipelineStages: {
      not_a_real_stage: {
        attempts: 1,
        hits: 0,
        misses: 1,
        elapsedMs: 0.5,
        budgetExhausted: 0,
        degraded: 0
      }
    }
  }
});
assert.equal(invalidResolverStagePipelineKey.ok, false, 'resolverPipelineStages must use known stage keys');

const invalidResolverStagePipelineCounters = validateArtifact('import_resolution_graph', {
  ...baseGraph,
  stats: {
    ...baseGraph.stats,
    resolverPipelineStages: {
      filesystem_probe: {
        attempts: -1,
        hits: 0,
        misses: 1,
        elapsedMs: 0.5,
        budgetExhausted: 0,
        degraded: 0
      }
    }
  }
});
assert.equal(invalidResolverStagePipelineCounters.ok, false, 'resolverPipelineStages counters must be non-negative');

console.log('import-resolution graph decision model schema test passed');
