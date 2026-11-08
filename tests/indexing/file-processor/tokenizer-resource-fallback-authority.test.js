import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { createScmFileProcessorContext, readFixture } from './scm-file-processor-test-helper.js';

// AUTHORED actual file/token consumer controls; no worker/native execution now.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'cleanup';
const cleanup = Object.freeze(Object.assign(new Error('original tokenizer cleanup owner'), {
  code: 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', workerOwnershipPending: true
}));
const failures = {
  cleanup, budget: Object.assign(new Error('process transport capacity denied'), { code: 'ERR_PROCESS_TASK_BUDGET' }),
  nested: new AggregateError([cleanup], 'wrapped original owner'),
  reacquire: Object.assign(new Error('original operation failed'), {
    cpuReacquisitionError: Object.assign(new Error('compute never reacquired'), { code: 'ERR_SCHEDULER_CPU_REACQUIRE' })
  }), ordinary: new Error('settled ordinary worker error')
};
const failure = failures[selected];
const fixture = await readFixture('tests', 'fixtures', 'mixed', 'src', 'config.yml');
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: 1000 });
const workerState = {}, messages = [];
let calls = 0;
const context = createScmFileProcessorContext({ ...fixture, scmProvider: null, scmProviderImpl: null,
  tokenContext: createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} }),
  log: message => messages.push(message), workerState,
  workerPool: { shouldUseForFile: () => true, getExecutionBackend: () => 'worker', tokenizeChunk: async () => { calls++; throw failure; } } });
try {
  const task = scheduler.schedule('file', { cpu: 1, bytes: 200 }, () => processFileCpu(context));
  if (selected === 'ordinary') {
    const result = await task;
    assert.ok(result.chunks.length > 0);
    assert.equal(workerState.workerTokenizeFailed, true, 'settled ordinary tokenizer error preserves inline authority');
  } else {
    await assert.rejects(task, error => error === failure);
    assert.equal(messages.some(message => message.includes('falling back to main thread')), false);
    assert.equal(workerState.workerTokenizeFailed, undefined, 'resource failure is never recorded as successful inline fallback');
  }
  assert.ok(calls > 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
} finally { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 }); }
console.log(`tokenizer ${selected} resource recovery authority control authored`);
