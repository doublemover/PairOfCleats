#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRuntimeMemoryPolicy } from '../../../src/index/build/runtime/workers.js';

const originalNodeOptions = process.env.NODE_OPTIONS;

try {
  process.env.NODE_OPTIONS = '--max-old-space-size=32768';

  const shifted = resolveRuntimeMemoryPolicy({
    indexingConfig: {
      memory: {
        workerHeapTargetMb: 512,
        workerHeapMinMb: 512,
        workerHeapMaxMb: 512,
        hotDictionaryMb: 256,
        hotSymbolMapMb: 160,
        reserveRssMb: 512
      }
    },
    cpuConcurrency: 1
  });

  assert.equal(
    shifted.cacheHotsetTargetMb,
    416,
    'expected cache hotset target to include dictionary and symbol-map hotsets'
  );
  assert.ok(
    shifted.perWorkerCacheMb >= shifted.perWorkerWriteBufferMb,
    'expected default policy to prioritize cache budget over write-buffer budget'
  );
  assert.ok(
    shifted.perWorkerCacheMb >= 416,
    'expected cache budget to cover configured dictionary/symbol hotset on a single-worker run'
  );

  const explicit = resolveRuntimeMemoryPolicy({
    indexingConfig: {
      memory: {
        workerHeapTargetMb: 512,
        workerHeapMinMb: 512,
        workerHeapMaxMb: 512,
        perWorkerCacheMb: 320,
        perWorkerWriteBufferMb: 144
      }
    },
    cpuConcurrency: 2
  });

  assert.equal(
    explicit.perWorkerCacheMb,
    320,
    'expected explicit perWorkerCacheMb override to remain authoritative'
  );
  assert.equal(
    explicit.perWorkerWriteBufferMb,
    144,
    'expected explicit perWorkerWriteBufferMb override to remain authoritative'
  );
} finally {
  if (originalNodeOptions == null) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = originalNodeOptions;
}

console.log('worker memory cache hotset policy test passed');
