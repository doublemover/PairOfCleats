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
const { tempRoot } = await prepareSinkCallFixture(
  root,
  'crossfile-prototype-param-name-regression',
  { paramName: 'toString' }
);
const chunks = createSinkCallChunks({
  paramName: 'toString',
  calleeRisk: null,
  callerDocmeta: {}
});

const stats = await applyCrossFileInference({
  rootDir: tempRoot,
  buildRoot: tempRoot,
  cacheEnabled: false,
  chunks,
  enabled: true,
  enableTypeInference: true,
  enableRiskCorrelation: false,
  log: () => {},
  fileRelations: null
});

assert.ok(stats.linkedCalls >= 1, 'expected call links to be generated');

const callee = chunks.find((chunk) => chunk.chunkUid === 'uid:callee');
assert.ok(callee, 'expected callee chunk');
const inferredParams = callee.docmeta?.inferredTypes?.params?.toString || [];
assert.ok(
  inferredParams.some((entry) => entry.type === 'string' && entry.source === 'flow'),
  'expected flow inference to support prototype-key param names'
);

await cleanupSinkCallFixture(tempRoot);

console.log('crossfile prototype-key param name regression test passed');
