import assert from 'node:assert/strict';
import { validateConfig } from '../../../src/config/validate.js';
import { loadConfigSchema } from '../../helpers/config-schema.js';
import { resolveSchedulerConfig } from '../../../src/index/build/runtime/scheduler.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { createRuntimeQueues } from '../../../src/index/build/runtime/workers.js';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';
import { createOrderedCompletionTracker } from '../../../src/shared/concurrency/ordered-completion.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { buildStage1SchedulerStallSnapshot, formatStage1SchedulerStallSummary } from '../../../src/index/build/indexer/steps/process-files/stall-diagnostics.js';
import { buildDependencySignatures } from '../../../src/index/build/indexer/signatures.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
ensureTestingEnv();

const indexingConfig = { scheduler: { enabled: true, adaptive: true,
  cpuTokens: 8, ioTokens: 16, memoryTokens: 32,
  adaptiveSurfaces: { surfaces: { parse: { minConcurrency: 8, maxConcurrency: 8, initialConcurrency: 8 } } } } };
const schema = await loadConfigSchema();
const accepted = validateConfig(schema, { indexing: indexingConfig });
assert.equal(accepted.ok, true, accepted.errors.join('; '));
for (const patch of [{ minConcurrency: 0 }, { initialConcurrency: 1.5 }, { maxConcurrency: '8' }, { typo: 8 }]) {
  const invalid = structuredClone(indexingConfig);
  Object.assign(invalid.scheduler.adaptiveSurfaces.surfaces.parse, patch);
  assert.equal(validateConfig(schema, { indexing: invalid }).ok, false, 'invalid parse limits must fail validation');
}
const invalidSurface = structuredClone(indexingConfig);
invalidSurface.scheduler.adaptiveSurfaces.surfaces.typo = {};
assert.equal(validateConfig(schema, { indexing: invalidSurface }).ok, false);
const config = resolveSchedulerConfig({ argv: {}, rawArgv: [], envConfig: {}, runtimeConfig: {}, indexingConfig,
  envelope: { concurrency: { cpuConcurrency: { value: 8 }, ioConcurrency: { value: 16 } } } });
assert.deepEqual(buildDependencySignatures({ indexingConfig }, 'code', 'fixture'),
  buildDependencySignatures({ indexingConfig: {} }, 'code', 'fixture'), 'scheduler changes preserve content dependency signatures');
const scheduler = createBuildScheduler(config);
const { queues } = createRuntimeQueues({ scheduler, cpuConcurrency: 8, fileConcurrency: 16, ioConcurrency: 16,
  pendingLimits: { cpu: { maxPending: 16, maxPendingBytes: 16 * 1024 * 1024 } } });
const bytes = 1024 * 1024;
const entries = Array.from({ length: 24 }, (_, orderIndex) => ({ orderIndex, bytes }));
let release;
const barrier = new Promise(resolve => { release = resolve; });
let eighthStarted;
const eight = new Promise(resolve => { eighthStarted = resolve; });
let active = 0, peak = 0, liveBytes = 0, peakBytes = 0;
const commits = [];
const tracker = createOrderedCompletionTracker();
const appender = buildOrderedAppender(async (_result, _state, _shard, context) => {
  commits.push(context.orderIndex);
}, {}, { expectedCount: entries.length, startIndex: 0, maxPendingBeforeBackpressure: 16, maxPendingBytes: 1024 * 1024 });
const controller = new AbortController();
const work = runWithQueue(queues.cpu, entries, async entry => {
  active++; peak = Math.max(peak, active);
  const scratch = Buffer.alloc(bytes); liveBytes += scratch.length; peakBytes = Math.max(peakBytes, liveBytes);
  if (active === 8) eighthStarted();
  await barrier;
  await new Promise(resolve => setTimeout(resolve, (7 - entry.orderIndex % 8) * 2));
  liveBytes -= scratch.length; active--;
  return { orderIndex: entry.orderIndex };
}, { collectResults: false, signal: controller.signal, requireSignal: true,
  onBeforeDispatch: ({ index }) => appender.waitForCapacity({ orderIndex: index, bypassWindow: 8, signal: controller.signal }),
  onResult: (result, { index }) => { tracker.track(appender.enqueue(index, result)); } });
await eight;
const snapshot = buildStage1SchedulerStallSnapshot({ scheduler });
assert.equal(snapshot.parseSurface.currentConcurrency, 8);
assert.equal(snapshot.parseSurface.running, 8);
assert.match(formatStage1SchedulerStallSummary(snapshot), /parse=r8\/p\d+\/cap8\/min8\/max8/);
release(); await work; await tracker.wait();
assert.deepEqual(commits, entries.map(entry => entry.orderIndex), 'out-of-order completion preserves commit order');
assert.equal(peak, 8); assert.equal(peakBytes, 8 * bytes);

// An explicit byte cap remains authoritative even with eight parse slots.
scheduler.registerQueue('stage1.cpu', { maxInFlightBytes: 2 * bytes });
let cancelRelease, twoStarted;
const held = new Promise(resolve => { cancelRelease = resolve; });
const two = new Promise(resolve => { twoStarted = resolve; });
const abort = new AbortController(); let started = 0;
const tasks = Array.from({ length: 12 }, () => queues.cpu.add(async () => {
  started++; if (started === 2) twoStarted(); await held;
}, { bytes, signal: abort.signal }).catch(error => error));
await two;
assert.equal(scheduler.stats().queues['stage1.cpu'].running, 2);
assert.equal(scheduler.stats().queues['stage1.cpu'].inFlightBytes, 2 * bytes);
abort.abort(); cancelRelease();
const outcomes = await Promise.all(tasks);
assert.equal(started, 2, 'cancellation must not start queued jobs');
assert.equal(outcomes.filter(value => value?.name === 'AbortError').length, 10);
await queues.cpu.onIdle();
assert.equal(scheduler.stats().activity.inFlightBytes, 0);
await scheduler.shutdown({ awaitRunning: true });
console.log('Eight Stage1 slots, ordered commits, 8 MiB fixture scratch, byte backpressure, cancellation and replay identity passed');
