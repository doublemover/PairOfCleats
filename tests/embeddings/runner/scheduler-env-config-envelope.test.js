#!/usr/bin/env node
import assert from 'node:assert/strict';
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
    envConfig: {
      ...process.env,
      PAIROFCLEATS_THREADS: '2'
    },
    indexingConfig: {}
  });
  schedulerHandle = schedulerRuntime?.scheduler || null;
  assert.equal(
    schedulerRuntime.envelopeCpuConcurrency,
    2,
    'expected scheduler runtime envelope to honor provided envConfig over process.env'
  );
  console.log('scheduler env-config envelope test passed');
} finally {
  schedulerHandle?.shutdown?.();
}
