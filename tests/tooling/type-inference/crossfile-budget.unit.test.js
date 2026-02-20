#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { applyCrossFileInference } from '../../../src/index/type-inference-crossfile.js';

ensureTestingEnv(process.env);

const buildChunk = ({ file, name, uid, relations = null }) => ({
  file,
  name,
  kind: 'function',
  chunkUid: uid,
  start: 0,
  end: 1,
  docmeta: {},
  codeRelations: relations || {}
});

const targets = Array.from({ length: 320 }, (_, i) => buildChunk({
  file: `src/targets_${Math.floor(i / 40)}.js`,
  name: `target_${i}`,
  uid: `uid-target-${i}`
}));

const largeCallList = targets.map((chunk) => ['caller', chunk.name]);
const largeUsageList = targets.map((chunk) => chunk.name);
const caller = buildChunk({
  file: 'src/caller.js',
  name: 'caller',
  uid: 'uid-caller',
  relations: {
    calls: largeCallList,
    usages: largeUsageList
  }
});

const fillers = Array.from({ length: 2700 }, (_, i) => buildChunk({
  file: `src/filler_${Math.floor(i / 40)}.js`,
  name: `filler_${i}`,
  uid: `uid-filler-${i}`
}));

const logs = [];
const stats = await applyCrossFileInference({
  rootDir: process.cwd(),
  chunks: [caller, ...targets, ...fillers],
  enabled: true,
  log: (line) => logs.push(String(line)),
  useTooling: false,
  enableTypeInference: false,
  enableRiskCorrelation: false,
  fileRelations: null
});

assert.ok(stats.linkedCalls <= 96, `expected call links to be capped, got ${stats.linkedCalls}`);
assert.ok(stats.linkedUsages <= 128, `expected usage links to be capped, got ${stats.linkedUsages}`);
assert.ok(stats.droppedCallLinks > 0, 'expected dropped call links with large repo budget');
assert.ok(stats.droppedUsageLinks > 0, 'expected dropped usage links with large repo budget');
assert.ok(
  logs.some((line) => line.includes('[perf] cross-file budget enabled')),
  'expected cross-file budget enable log'
);

console.log('cross-file budget unit test passed');
