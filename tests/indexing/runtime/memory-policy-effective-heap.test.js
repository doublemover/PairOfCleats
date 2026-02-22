#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveRuntimeMemoryPolicy } from '../../../src/index/build/runtime/workers.js';
import { resolveWorkerResourceLimits } from '../../../src/index/build/workers/config.js';

applyTestEnv();

const originalNodeOptions = process.env.NODE_OPTIONS;

try {
  process.env.NODE_OPTIONS = '--max-old-space-size=2048';

  const policy = resolveRuntimeMemoryPolicy({
    indexingConfig: {},
    cpuConcurrency: 7
  });
  const expectedLimits = resolveWorkerResourceLimits(7, policy.workerHeapPolicy);
  const expectedHeapMb = expectedLimits?.maxOldGenerationSizeMb;

  assert.equal(
    policy.effectiveWorkerHeapMb,
    expectedHeapMb,
    'expected runtime memory policy to use effective worker heap limits (after budget clamping)'
  );
  const expectedDefaultCacheMb = Math.max(
    128,
    Math.floor(policy.effectiveWorkerHeapMb * 0.5),
    policy.cacheHotsetTargetMb
  );
  assert.equal(
    policy.perWorkerCacheMb,
    expectedDefaultCacheMb,
    'expected default per-worker cache budget to derive from effective heap with hotset floor, not target heap'
  );
  const expectedDefaultWriteBufferMb = Math.max(
    128,
    Math.min(640, Math.floor(policy.effectiveWorkerHeapMb * 0.35))
  );
  assert.equal(
    policy.perWorkerWriteBufferMb,
    expectedDefaultWriteBufferMb,
    'expected default per-worker write-buffer budget to derive from effective heap, not target heap'
  );
} finally {
  if (originalNodeOptions == null) {
    delete process.env.NODE_OPTIONS;
  } else {
    process.env.NODE_OPTIONS = originalNodeOptions;
  }
}

console.log('runtime memory policy effective heap test passed');
