import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { withSchedulerCpuSuspended, currentSchedulerTaskLease } from '../../../src/shared/concurrency/scheduler-task-scope.js';
import { createTokenizationContext, createTokenizationBuffers, tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { createScmFileProcessorContext, readFixture } from './scm-file-processor-test-helper.js';

// AUTHORED: actual SCM and token consumers share one CPU envelope; waits are inert.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'normal';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await tick(); assert.ok(check()); };
const fixture = await readFixture('tests', 'fixtures', 'mixed', 'src', 'config.yml');
const scmGate = deferred(), tokenGate = deferred(), controller = new AbortController();
const signal = controller.signal;
const scheduler = createBuildScheduler({ cpuTokens: 1, memoryTokens: 1, maxInFlightBytes: 1000 });
const tokenContext = createTokenizationContext({ dictWords: new Set(), dictConfig: {}, postingsConfig: {} });
let phase = 'start', tokenCalls = 0;
const original = Object.freeze(Object.assign(new Error('tokenizer original cleanup failure'), {
  code: 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', workerOwnershipPending: true
}));
const context = createScmFileProcessorContext({ ...fixture, signal, tokenContext, gitBlameEnabled: false,
  scmConfig: { allowSlowTimeouts: true, timeoutMs: 2000, annotate: {} },
  runProc: operation => withSchedulerCpuSuspended(() => scheduler.schedule('proc', { cpu: 1, mem: 1, signal }, operation)),
  scmProviderImpl: { getFileMeta: async () => {
    phase = 'scm'; await withSchedulerCpuSuspended(() => scmGate.promise);
    assert.equal(currentSchedulerTaskLease().used.cpu, 1, 'provider parsing owns compute after wait');
    return { ok: true, lastModifiedAt: '2026-10-23T00:00:00Z', lastAuthor: 'fixture', lastCommitId: 'abcdef0' };
  } },
  workerPool: { shouldUseForFile: () => true, getExecutionBackend: () => 'worker', tokenizeChunk: async row => {
    phase = 'token'; tokenCalls++; await withSchedulerCpuSuspended(() => tokenGate.promise);
    assert.equal(currentSchedulerTaskLease().used.cpu, 1, 'actual token compute remains admitted');
    if (selected === 'failure') throw original;
    if (signal.aborted) throw Object.assign(new Error('token canceled'), { name: 'AbortError' });
    return tokenizeChunkText({ ...row, context: tokenContext, buffers: createTokenizationBuffers() });
  } } });
const task = scheduler.schedule('file', { cpu: 1, bytes: 300, signal }, () => processFileCpu(context));
const rejection = selected === 'failure' ? assert.rejects(task, error => error === original)
  : selected === 'cancel' ? assert.rejects(task, { name: 'AbortError' }) : null;
try {
  await until(() => phase === 'scm' && scheduler.stats().tokens.cpu.used === 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 300);
  assert.equal(scheduler.stats().tokens.mem.used, 1);
  await scheduler.schedule('ready', { cpu: 1 }, () => 'ready during SCM');
  scmGate.resolve();
  await until(() => phase === 'token' && scheduler.stats().tokens.cpu.used === 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 300);
  await scheduler.schedule('ready', { cpu: 1 }, () => 'ready during token admission');
  if (selected === 'cancel') controller.abort();
  tokenGate.resolve();
  if (rejection) await rejection;
  else assert.ok((await task).chunks.length > 0);
  assert.ok(tokenCalls > 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  assert.equal(scheduler.stats().tokens.mem.used, 0);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
} finally {
  scmGate.resolve(); tokenGate.resolve(); await Promise.allSettled([task]);
  await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
console.log(`mixed SCM/token ${selected} one-CPU ownership control authored`);
