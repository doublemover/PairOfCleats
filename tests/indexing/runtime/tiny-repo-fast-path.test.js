#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { indexerPipelineInternals } from '../../../src/index/build/indexer/pipeline.js';

applyTestEnv();

const { resolveTinyRepoFastPath } = indexerPipelineInternals;

const disabled = resolveTinyRepoFastPath({
  runtime: { indexingConfig: {} },
  entries: [{ stat: { size: 120 } }]
});
assert.equal(disabled.enabled, false, 'expected tiny-repo fast path to be opt-in');
assert.equal(disabled.active, false, 'expected tiny-repo fast path inactive when unconfigured');

const enabled = resolveTinyRepoFastPath({
  runtime: {
    indexingConfig: {
      tinyRepoFastPath: {
        enabled: true,
        maxEstimatedLines: 5000,
        maxFiles: 32,
        maxBytes: 1024 * 1024
      }
    }
  },
  entries: [
    { stat: { size: 4000 } },
    { stat: { size: 2200 } },
    { size: 1024 }
  ]
});
assert.equal(enabled.enabled, true, 'expected tiny-repo fast path enabled');
assert.equal(enabled.active, true, 'expected tiny-repo profile to activate for small repos');
assert.equal(enabled.disableImportGraph, true, 'expected import graph disable shortcut');
assert.equal(enabled.disableCrossFileInference, true, 'expected cross-file disable shortcut');
assert.equal(enabled.minimalArtifacts, true, 'expected minimal artifact shortcut');

const thresholdMiss = resolveTinyRepoFastPath({
  runtime: {
    indexingConfig: {
      tinyRepoFastPath: {
        enabled: true,
        maxEstimatedLines: 5000,
        maxFiles: 32,
        maxBytes: 1024 * 1024
      }
    }
  },
  entries: [{ stat: { size: 2 * 1024 * 1024 } }]
});
assert.equal(thresholdMiss.active, false, 'expected oversized repo to skip tiny fast path');
assert.equal(thresholdMiss.reason, 'threshold-miss', 'expected threshold miss reason');

console.log('tiny repo fast path test passed');
