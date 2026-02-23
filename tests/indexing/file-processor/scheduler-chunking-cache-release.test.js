#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { chunkWithScheduler } from '../../../src/index/build/file-processor/cpu/scheduler-chunking.js';

applyTestEnv();

const text = 'export const value = 1;\n';
const segment = {
  start: 0,
  end: text.length,
  languageId: 'javascript'
};

const buildBaseInput = () => ({
  segments: [segment],
  tokenMode: 'code',
  mustUseTreeSitterScheduler: true,
  treeSitterEnabled: true,
  treeSitterConfigForMode: {},
  treeSitterStrict: true,
  text,
  ext: '.js',
  relKey: 'src/sample.js',
  mode: 'code',
  lang: { id: 'javascript' },
  segmentContext: null,
  lineIndex: null,
  logLine: null,
  updateCrashStage: () => {}
});

const releasedSuccess = [];
const successScheduler = {
  index: new Map(),
  scheduledLanguageIds: new Set(['javascript']),
  loadChunksBatch: async (virtualPaths, options = {}) => {
    assert.equal(options.consume, false, 'expected scheduler lookup to opt out of auto-consume');
    return virtualPaths.map(() => [{ start: 0, end: text.length, text }]);
  },
  releaseVirtualPathCaches: (virtualPath) => {
    releasedSuccess.push(virtualPath);
  },
  isDegradedVirtualPath: () => false
};

const success = await chunkWithScheduler({
  ...buildBaseInput(),
  treeSitterScheduler: successScheduler
});
assert.equal(success.chunks.length, 1, 'expected scheduled chunk output');
assert.equal(releasedSuccess.length, 1, 'expected scheduler caches to be released after successful batch load');

const releasedFailure = [];
const failingScheduler = {
  index: new Map(),
  scheduledLanguageIds: new Set(['javascript']),
  loadChunksBatch: async (virtualPaths) => virtualPaths.map(() => []),
  releaseVirtualPathCaches: (virtualPath) => {
    releasedFailure.push(virtualPath);
  },
  isDegradedVirtualPath: () => false
};

let threw = false;
try {
  await chunkWithScheduler({
    ...buildBaseInput(),
    treeSitterScheduler: failingScheduler
  });
} catch (err) {
  threw = true;
  assert.match(String(err?.message || ''), /Missing scheduled chunks/, 'expected strict scheduler miss to throw');
}

assert.equal(threw, true, 'expected strict scheduler miss to throw');
assert.equal(releasedFailure.length, 1, 'expected scheduler caches to be released even when strict mode throws');

console.log('scheduler chunking cache release test passed');
