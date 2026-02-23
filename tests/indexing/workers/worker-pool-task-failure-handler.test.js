#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  classifyWorkerRunError,
  createWorkerTaskFailureHandler
} from '../../../src/index/build/workers/pool/task-failure.js';

const cloneClassification = classifyWorkerRunError({
  err: { name: 'DataCloneError', message: 'value could not be cloned' }
});
assert.equal(cloneClassification.isCloneError, true, 'expected DataCloneError classification');
assert.equal(cloneClassification.opaqueFailure, false, 'expected clone failure to keep detailed message');

const opaqueClassification = classifyWorkerRunError({
  err: new Error('ignored'),
  summarizeError: () => 'Error'
});
assert.equal(opaqueClassification.opaqueFailure, true, 'expected opaque error classification');

const lifecycleCalls = [];
const lifecycle = {
  async disablePermanently(reason) {
    lifecycleCalls.push({ type: 'disable', reason });
  },
  async scheduleRestart(reason) {
    lifecycleCalls.push({ type: 'restart', reason });
  }
};
const crashEvents = [];
const crashLogger = {
  enabled: true,
  logError(payload) {
    crashEvents.push(payload);
  }
};
const poolForMeta = {
  acquire: () => ({ file: null }),
  release: () => {}
};
const withPooledPayloadMeta = (pool, assign, fn) => {
  const meta = pool.acquire();
  assign(meta);
  try {
    return fn(meta);
  } finally {
    pool.release(meta);
  }
};
const assignPayloadMeta = (target, payload) => {
  target.file = payload?.file || null;
};

const failureHandler = createWorkerTaskFailureHandler({
  lifecycle,
  crashLogger,
  withPooledPayloadMeta
});

await failureHandler.handleRunFailure({
  err: new Error('transient worker error'),
  phase: 'worker-tokenize',
  task: 'tokenizeChunk',
  payload: { file: 'alpha.js' },
  payloadMetaPool: poolForMeta,
  assignPayloadMeta
});
assert.deepEqual(
  lifecycleCalls.map((entry) => entry.type),
  ['restart'],
  'expected detailed worker failures to schedule restart'
);
assert.equal(crashEvents[0]?.phase, 'worker-tokenize', 'expected crash logger phase for failure');
assert.equal(crashEvents[0]?.task, 'tokenizeChunk', 'expected crash logger task for failure');
assert.equal(crashEvents[0]?.payloadMeta?.file, 'alpha.js', 'expected pooled payload meta on failure');

await failureHandler.handleRunFailure({
  err: { name: 'DataCloneError', message: 'non-cloneable payload' },
  phase: 'worker-tokenize',
  task: 'tokenizeChunk',
  payload: { file: 'beta.js' },
  payloadMetaPool: poolForMeta,
  assignPayloadMeta
});
assert.deepEqual(
  lifecycleCalls.map((entry) => entry.type),
  ['restart', 'disable'],
  'expected clone errors to disable the worker pool permanently'
);

failureHandler.reportUnavailable({
  phase: 'worker-tokenize',
  task: 'tokenizeChunk',
  payload: { file: 'gamma.js' },
  payloadMetaPool: poolForMeta,
  assignPayloadMeta
});
assert.equal(crashEvents.length, 3, 'expected unavailable event to be logged');
assert.equal(crashEvents[2]?.message, 'worker pool unavailable', 'expected unavailable crash message');
assert.equal(crashEvents[2]?.payloadMeta?.file, 'gamma.js', 'expected payload meta on unavailable event');

console.log('worker pool task failure handler test passed');
