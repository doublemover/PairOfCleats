#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { treeSitterSchedulerExecutorInternals } from '../../../src/index/build/tree-sitter-scheduler/executor.js';

applyTestEnv({ testing: '1' });

const {
  resolveEscalatedParseTimeoutMs,
  buildSchedulerCacheKey,
  buildTreeSitterOptionsForJob
} = treeSitterSchedulerExecutorInternals;

const smallTimeout = resolveEscalatedParseTimeoutMs({
  baseTimeoutMs: 300,
  segmentText: 'const x = 1;',
  parseMode: 'full'
});
const largeTimeout = resolveEscalatedParseTimeoutMs({
  baseTimeoutMs: 300,
  segmentText: `${'line\n'.repeat(15000)}`,
  parseMode: 'full'
});
assert.ok(largeTimeout > smallTimeout, 'expected timeout escalation for complex files');

const cacheKey = buildSchedulerCacheKey({
  languageId: 'cpp',
  parseMode: 'lightweight-relations',
  expectedSignature: { hash: 'abc123', size: 42, mtimeMs: 100 },
  segmentStart: 10,
  segmentEnd: 30
});
assert.ok(cacheKey.includes('abc123'), 'expected cache key to include content signature hash');

const options = buildTreeSitterOptionsForJob({
  strictTreeSitter: {
    enabled: true,
    maxParseMs: 400,
    byLanguage: { cpp: { maxParseMs: 450 } }
  },
  runtime: { repoCacheRoot: path.join(process.cwd(), '.testCache', 'tree-sitter-timeout-mode') },
  log: null,
  job: { languageId: 'cpp', parseMode: 'lightweight-relations', segmentStart: 0, segmentEnd: 100 },
  segmentText: `${'x\n'.repeat(4000)}`,
  expectedSignature: { hash: 'sig', size: 99, mtimeMs: 123 }
});
assert.equal(options.treeSitter.useQueries, false, 'expected lightweight mode to disable query-heavy parse mode');
assert.equal(options.treeSitter.cachePersistent, true, 'expected persistent cache enablement for scheduler jobs');
assert.ok(
  String(options.treeSitter.cachePersistentDir || '').includes('tree-sitter-scheduler'),
  'expected scheduler cache directory namespace'
);
assert.ok(typeof options.treeSitterCacheKey === 'string' && options.treeSitterCacheKey.length > 10);

console.log('tree-sitter scheduler timeout/cache mode test passed');
