#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../../helpers/test-env.js';
import { applyCrossFileInference } from '../../../../src/index/type-inference-crossfile/pipeline.js';

import {
  cleanupSinkCallFixture,
  createSinkCallChunks,
  prepareSinkCallFixture
} from './sink-call-fixture.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_CROSSFILE_PROPAGATION_PARALLEL: '1',
    PAIROFCLEATS_CROSSFILE_PROPAGATION_PARALLEL_MIN_BUNDLE: '1'
  }
});

const root = process.cwd();
const { tempRoot } = await prepareSinkCallFixture(root, 'crossfile-propagation-parallel-mode');

const runOnce = async () => {
  const logs = [];
  const chunks = createSinkCallChunks();
  const stats = await applyCrossFileInference({
    rootDir: tempRoot,
    buildRoot: tempRoot,
    cacheEnabled: false,
    chunks,
    enabled: true,
    enableTypeInference: true,
    enableRiskCorrelation: true,
    log: (line) => logs.push(String(line || '')),
    fileRelations: null
  });
  return { stats, logs, chunks };
};

const first = await runOnce();
const second = await runOnce();

assert.ok(
  first.logs.some((line) => line.includes('cross-file propagation parallel mode enabled')),
  'expected propagation parallel mode log when bundle threshold is met'
);
assert.ok(first.stats.linkedCalls >= 1, 'expected call links to be generated');
assert.ok(first.stats.riskFlows >= 1, 'expected risk flow propagation to run');

const callee = first.chunks.find((chunk) => chunk.chunkUid === 'uid:callee');
const caller = first.chunks.find((chunk) => chunk.chunkUid === 'uid:caller');
assert.ok(callee, 'expected callee chunk');
assert.ok(caller, 'expected caller chunk');
const inferredParams = callee.docmeta?.inferredTypes?.params?.value || [];
assert.ok(
  inferredParams.some((entry) => entry.type === 'string' && entry.source === 'flow'),
  'expected type propagation to infer string param type on callee'
);
assert.ok(
  Array.isArray(caller.docmeta?.risk?.flows) && caller.docmeta.risk.flows.length > 0,
  'expected risk propagation to add cross-file flow on caller chunk'
);

const snapshot = (run) => JSON.stringify(
  run.chunks.map((chunk) => ({
    uid: chunk.chunkUid,
    callLinks: chunk.codeRelations?.callLinks || [],
    callSummaries: chunk.codeRelations?.callSummaries || [],
    inferredParams: chunk.docmeta?.inferredTypes?.params || null,
    riskFlows: chunk.docmeta?.risk?.flows || []
  }))
);
assert.equal(snapshot(second), snapshot(first), 'parallel propagation should remain deterministic');

await cleanupSinkCallFixture(tempRoot);

console.log('cross-file propagation parallel mode test passed');
