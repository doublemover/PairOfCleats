#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRuntimeMemoryPolicy } from '../../../../src/index/build/runtime/workers.js';

const originalNodeOptions = process.env.NODE_OPTIONS;

try {
  process.env.NODE_OPTIONS = '--max-old-space-size=32768';

  const base = resolveRuntimeMemoryPolicy({
    indexingConfig: {
      memory: {
        workerHeapTargetMb: 512,
        workerHeapMinMb: 512,
        workerHeapMaxMb: 512,
        reserveRssMb: 512
      },
      hugeRepoProfile: { enabled: false }
    },
    cpuConcurrency: 1
  });

  const huge = resolveRuntimeMemoryPolicy({
    indexingConfig: {
      memory: {
        workerHeapTargetMb: 512,
        workerHeapMinMb: 512,
        workerHeapMaxMb: 512,
        reserveRssMb: 512
      },
      hugeRepoProfile: { enabled: true }
    },
    cpuConcurrency: 1
  });

  assert.ok(
    huge.perWorkerWriteBufferMb >= base.perWorkerWriteBufferMb,
    'expected huge profile write buffer to stay at or above baseline per-worker budget'
  );
  assert.ok(
    huge.writeBufferHeadroomBoostMb > 0,
    'expected huge profile to increase write buffers when RSS headroom is available'
  );
  assert.equal(
    huge.hugeProfileWriteBufferBoosted,
    true,
    'expected huge profile write buffer boost telemetry flag'
  );
} finally {
  if (originalNodeOptions == null) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = originalNodeOptions;
}

console.log('worker memory huge write buffer headroom test passed');
