#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

import {
  cleanupSinkCallFixture,
  createSinkCallChunks,
  prepareSinkCallFixture
} from './sink-call-fixture.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const { tempRoot } = await prepareSinkCallFixture(root, 'crossfile-inference-lite-profile');

const runMode = async ({ inferenceLite }) => {
  const chunks = createSinkCallChunks({
    calleeInferredTypes: { returns: [{ type: 'string', source: 'declared', confidence: 0.9 }] }
  });
  const stats = await applyCrossFileInference({
    rootDir: tempRoot,
    buildRoot: tempRoot,
    cacheEnabled: false,
    chunks,
    enabled: true,
    enableTypeInference: true,
    enableRiskCorrelation: true,
    inferenceLite,
    inferenceLiteHighSignalOnly: true,
    fileRelations: null,
    log: () => {}
  });
  return { chunks, stats };
};

const full = await runMode({ inferenceLite: false });
const lite = await runMode({ inferenceLite: true });

assert.ok(full.stats.linkedCalls > 0, 'expected full mode to emit call links');
assert.ok(full.stats.inferredReturns > 0, 'expected full mode to infer return types');
assert.ok(full.stats.riskFlows > 0, 'expected full mode to emit risk flows');

assert.ok(lite.stats.linkedCalls > 0, 'expected lite mode to preserve call link emission');
assert.equal(lite.stats.inferredReturns, 0, 'expected lite mode to skip return inference');
assert.equal(lite.stats.riskFlows, 0, 'expected lite mode to skip risk propagation');
assert.equal(lite.stats.inferenceLiteEnabled, true, 'expected lite-mode telemetry flag');

await cleanupSinkCallFixture(tempRoot);

console.log('cross-file inference lite profile test passed');
