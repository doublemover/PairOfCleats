#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createQueuedArtifactWritePlanner } from '../../../src/index/build/artifacts/write-queue.js';
import { dispatchArtifactWrites } from '../../../src/index/build/artifacts/write-dispatch.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const makeDispatcher = (entries, overrides = {}) => {
  const activeWriteMeta = new Map();
  const metadata = [];
  const metrics = new Map();
  const input = {
    laneQueues: { ultraLight: entries.slice(), massive: [], light: [], heavy: [] },
    writeFsStrategy: { mode: 'generic', microCoalescing: false },
    ultraLightWriteThresholdBytes: 64 * 1024,
    writeTailWorkerEnabled: false, writeTailRescueEnabled: false,
    adaptiveWriteConcurrencyEnabled: false, adaptiveWriteObserveIntervalMs: 0,
    writeConcurrency: 1, hostConcurrency: 1, scheduler: null, effectiveAbortSignal: null,
    canDispatchEntryUnderHugeWritePolicy: () => true,
    activeWrites: new Map(), activeWriteBytes: new Map(), activeWriteMeta,
    hugeWriteState: { bytes: 0, families: new Set() },
    updateWriteInFlightTelemetry: () => {}, getLongestWriteStallSeconds: () => 0,
    getActiveWriteTelemetrySnapshot: () => ({ inflight: [], previewText: '', phaseSummaryText: '' }),
    updateActiveWriteMeta: (label, patch) => {
      activeWriteMeta.set(label, { ...(activeWriteMeta.get(label) || {}), ...patch });
    },
    resolveEntryEstimatedBytes: (entry) => Number(entry?.estimatedBytes) || 0,
    resolveHugeWriteFamily: () => null,
    massiveWriteIoTokens: 1, massiveWriteMemTokens: 0,
    writeTailRescueBoostIoTokens: 0, writeTailRescueBoostMemTokens: 0,
    resolveArtifactWriteMemTokens: () => 0, outDir: process.cwd(),
    artifactMetrics: metrics, artifactQueueDelaySamples: new Map(),
    updatePieceMetadata: (label, value) => { metadata.push({ label, value }); },
    formatBytes: String, logLine: () => {}, logWriteProgress: () => {},
    writeHeartbeat: { start() {}, stop() {}, clearLabelAlerts() {} }, ...overrides
  };
  return { input, metadata, metrics };
};

const entries = [];
const firstDone = deferred();
const secondStarted = deferred();
const secondDone = deferred();
const payload = Buffer.alloc(16 * 1024, 7);
const firstResult = { bytes: 1, checksum: 'a', checksumAlgo: 'sha1', payload };
const producedPieces = [];
const planner = createQueuedArtifactWritePlanner({ writes: entries,
  addPieceFile: (entry, filePath) => producedPieces.push({ entry, filePath }) });
planner.enqueueWrite('eager.json', async () => firstDone.promise, {
  eagerStart: true, estimatedBytes: 1,
  onSuccess: () => {
    assert.equal(typeof entries[0].job, 'function', 'producer callback still owns its pending entry');
  },
  publishedPieces: [{ entry: { name: 'eager' }, filePath: 'eager.json' }]
});
firstDone.resolve(firstResult);
await entries[0].prefetched;
assert.equal(typeof entries[0].job, 'function', 'a completed prefetch is retained until dispatcher consumption');
assert.equal(await entries[0].prefetched, firstResult);
planner.enqueueWrite('pending.json', async () => {
  secondStarted.resolve();
  return secondDone.promise;
}, { estimatedBytes: 1 });
const manualJob = async () => { throw new Error('a prefetched direct entry must not rerun'); };
const manualPromise = Promise.resolve({ bytes: 3 });
const manual = { label: 'manual.json', job: manualJob, prefetched: manualPromise, estimatedBytes: 1 };
const fixture = makeDispatcher([...entries, manual]);
const dispatch = dispatchArtifactWrites(fixture.input);
try {
  await secondStarted.promise;
  assert.equal(entries[0].job, null, 'completed app-owned entry must retire its payload closure before later writes finish');
  assert.equal(entries[0].prefetched, null, 'consumed eager result promise must leave the retained planning array');
  assert.equal(typeof entries[1].job, 'function', 'the pending write remains owned until it settles');
  assert.equal(fixture.metadata[0].value.bytes, 1);
  assert.equal(fixture.metadata[0].value.checksum, 'a');
} finally {
  secondDone.resolve({ bytes: 2 });
  await dispatch;
}
assert.equal(entries[1].job, null);
assert.deepEqual(fixture.metadata.map(({ label, value }) => [label, value.bytes]),
  [['eager.json', 1], ['pending.json', 2], ['manual.json', 3]]);
assert.deepEqual(producedPieces, [{ entry: { name: 'eager' }, filePath: 'eager.json' }]);
assert.equal(manual.job, manualJob, 'direct dispatcher entries retain their existing callable contract');
assert.equal(manual.prefetched, manualPromise);
assert.equal(firstResult.payload, payload, 'retirement does not mutate the result held by its producer');
assert.equal(payload[0], 7);

for (const stage of ['job', 'scheduler', 'metadata']) {
  const failedEntries = [];
  const failure = new Error(`controlled ${stage} failure`);
  let pendingCalls = 0;
  const failurePlanner = createQueuedArtifactWritePlanner({ writes: failedEntries });
  failurePlanner.enqueueWrite('failed.json', async () => {
    if (stage === 'job') throw failure;
    return { bytes: 1 };
  }, { estimatedBytes: 1 });
  failurePlanner.enqueueWrite('unstarted.json', async () => {
    pendingCalls += 1;
    return { bytes: 1 };
  }, { estimatedBytes: 1 });
  const options = stage === 'scheduler'
    ? { scheduler: { schedule: () => Promise.reject(failure) } }
    : stage === 'metadata' ? { updatePieceMetadata: () => { throw failure; } } : {};
  const failedFixture = makeDispatcher(failedEntries, options);
  await assert.rejects(dispatchArtifactWrites(failedFixture.input), (error) => error === failure);
  assert.equal(failedEntries[0].job, null, `${stage}: failed dispatch attempt retires its own closure`);
  assert.equal(failedEntries[0].prefetched, null);
  assert.equal(typeof failedEntries[1].job, 'function', `${stage}: unstarted entries are not prematurely retired`);
  assert.equal(pendingCalls, 0);
}

const frozenEntries = [];
const frozenPlanner = createQueuedArtifactWritePlanner({ writes: frozenEntries });
frozenPlanner.enqueueWrite('frozen.json', async () => ({ bytes: 1 }), { estimatedBytes: 1 });
const frozenJob = frozenEntries[0].job;
Object.freeze(frozenEntries[0]);
await dispatchArtifactWrites(makeDispatcher(frozenEntries).input);
assert.equal(frozenEntries[0].job, frozenJob, 'read-only caller entries must not turn retirement into a cleanup failure');
console.log('Artifact write entry lifetime passed: completed/failed owned jobs and eager promises retired; pending/manual/result owners preserved');
