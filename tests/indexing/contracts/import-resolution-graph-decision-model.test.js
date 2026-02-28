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
      category: 'missing_file',
      confidence: 0.9
    }
  ],
  stats: {
    unresolvedByReasonCode: { IMP_U_MISSING_FILE_RELATIVE: 1 },
    unresolvedByFailureCause: { missing_file: 1 },
    unresolvedByDisposition: { actionable: 1 },
    unresolvedByResolverStage: { filesystem_probe: 1 }
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

console.log('import-resolution graph decision model schema test passed');
