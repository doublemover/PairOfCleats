#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveRuntimeMemoryPolicy } from '../../../src/index/build/runtime/workers.js';

applyTestEnv();

const basePolicy = resolveRuntimeMemoryPolicy({
  indexingConfig: {
    memory: {
      workerHeapTargetMb: 256
    }
  },
  cpuConcurrency: 2
});

const highMemoryPolicy = resolveRuntimeMemoryPolicy({
  indexingConfig: {
    memory: {
      workerHeapTargetMb: 256,
      highMemoryProfile: {
        enabled: true,
        thresholdMb: 4096,
        cacheScale: 1.6,
        writeBufferScale: 1.4,
        postingsScale: 1.3
      }
    }
  },
  cpuConcurrency: 2
});

assert.equal(
  highMemoryPolicy.highMemoryProfile.enabled,
  true,
  'expected high-memory profile enable flag'
);
assert.equal(
  highMemoryPolicy.highMemoryProfile.thresholdMb,
  4096,
  'expected configured high-memory threshold'
);
assert.equal(
  highMemoryPolicy.highMemoryProfile.postingsScale,
  1.3,
  'expected configured postings scale'
);
assert.ok(
  highMemoryPolicy.perWorkerCacheMb >= basePolicy.perWorkerCacheMb,
  'expected high-memory profile to keep-or-increase per-worker cache'
);
assert.ok(
  highMemoryPolicy.perWorkerWriteBufferMb >= basePolicy.perWorkerWriteBufferMb,
  'expected high-memory profile to keep-or-increase write buffer'
);

if (highMemoryPolicy.highMemoryProfile.applied) {
  assert.ok(
    highMemoryPolicy.perWorkerCacheMb > basePolicy.perWorkerCacheMb
      || highMemoryPolicy.perWorkerWriteBufferMb > basePolicy.perWorkerWriteBufferMb,
    'expected applied high-memory profile to boost cache or write-buffer budget'
  );
}

const disabledPolicy = resolveRuntimeMemoryPolicy({
  indexingConfig: {
    memory: {
      workerHeapTargetMb: 256,
      highMemoryProfile: {
        enabled: false
      }
    }
  },
  cpuConcurrency: 2
});

assert.equal(
  disabledPolicy.highMemoryProfile.enabled,
  false,
  'expected explicit disable to turn off high-memory profile'
);
assert.equal(
  disabledPolicy.highMemoryProfile.applied,
  false,
  'expected disabled high-memory profile to remain unapplied'
);

console.log('runtime memory policy high-memory profile test passed');
