#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';

applyTestEnv();

const events = [];
await teardownRuntime({
  log: () => {},
  scheduler: {
    async shutdown() {
      events.push('scheduler.shutdown');
    }
  },
  workerPools: {
    async destroy() {
      events.push('workerPools.destroy');
    }
  }
});

assert.deepEqual(
  events,
  ['scheduler.shutdown', 'workerPools.destroy'],
  'expected scheduler shutdown before worker pool destruction'
);

console.log('runtime teardown order test passed');
