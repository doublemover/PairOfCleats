#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { createEmbeddingsScheduler } from '../../../tools/build/embeddings/scheduler.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_THREADS: '11'
  }
});

let schedulerHandle = null;
try {
  const schedulerRuntime = createEmbeddingsScheduler({
    argv: {},
    rawArgv: [],
    userConfig: {},
    rawEnv: {
      ...process.env,
      PAIROFCLEATS_THREADS: '2', UV_THREADPOOL_SIZE: '3', NODE_OPTIONS: '--max-old-space-size=512'
    },
    envConfig: getEnvConfig({ PAIROFCLEATS_THREADS: '2' }),
    indexingConfig: {}
  });
  schedulerHandle = schedulerRuntime?.scheduler || null;
  assert.equal(
    schedulerRuntime.envelopeCpuConcurrency,
    2,
    'expected scheduler runtime envelope to honor provided rawEnv over process.env'
  );
  assert.equal(schedulerRuntime.runtimeEnvelope.runtime.uvThreadpoolSize.effective.value, 3);
  assert.equal(schedulerRuntime.runtimeEnvelope.runtime.maxOldSpaceMb.effective.value, 512);
  console.log('scheduler env-config envelope test passed');
} finally {
  schedulerHandle?.shutdown?.();
}
