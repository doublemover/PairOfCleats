#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveOrderedAppenderConfig } from '../../../src/index/build/indexer/steps/process-files/planner.js';

ensureTestingEnv(process.env);

const runtime = {
  fileConcurrency: 32,
  queues: {
    cpu: {
      maxPending: 128
    }
  },
  stage1Queues: {
    ordered: {},
    window: {}
  }
};

const resolved = resolveOrderedAppenderConfig(runtime);
assert.equal(
  resolved.maxPendingBeforeBackpressure,
  640,
  'expected ordered pending default to scale with file concurrency, not cpu queue pending'
);

const configured = resolveOrderedAppenderConfig({
  ...runtime,
  stage1Queues: {
    ...runtime.stage1Queues,
    ordered: {
      maxPending: 333
    }
  }
});
assert.equal(configured.maxPendingBeforeBackpressure, 333, 'expected explicit ordered maxPending override');

console.log('stage1 ordered appender defaults test passed');
