import assert from 'node:assert/strict';
import { dispatchArtifactWrites } from '../../../src/index/build/artifacts/write-dispatch.js';
import { createQueuedArtifactWritePlanner } from '../../../src/index/build/artifacts/write-queue.js';
import { selectMicroWriteBatch } from '../../../src/index/build/artifacts/write-strategy.js';
import { buildActiveWriteTelemetrySnapshot } from '../../../src/index/build/artifacts/write-telemetry.js';

const run = async ({ micro = true, avoid = null, blocked = null, permanent = false,
  concurrent = false, prefetch = false, maxCount = 4, maxBytes = 1000 } = {}) => {
  const executed = [], succeeded = [], registered = [], progress = [], metadata = [];
  const writes = [], activeWrites = new Map(), activeWriteBytes = new Map(), activeWriteMeta = new Map();
  const metrics = new Map(), ledger = new Map();
  const updateActiveWriteMeta = (label, patch) => activeWriteMeta.set(label, { ...activeWriteMeta.get(label), ...patch });
  const planner = createQueuedArtifactWritePlanner({ writes, updateActiveWriteMeta,
    addPieceFile: entry => registered.push(entry.label) });
  let allow = blocked === null, releaseActive;
  const activeGate = new Promise(resolve => { releaseActive = resolve; });
  for (const [index, label] of ['A', 'B', 'C'].entries()) {
    planner.enqueueWrite(label, async () => {
      executed.push(label);
      if (concurrent && label === 'A') await activeGate;
      if (label === 'C') { if (!permanent) allow = true; releaseActive(); }
      return { bytes: 100, checksum: label, checksumAlgo: 'sha256' };
    }, { estimatedBytes: 100, laneHint: 'ultraLight', family: index === 1 ? 'family-b' : 'family-a',
      eagerStart: prefetch, publishedPieces: [{ entry: { label }, filePath: `${label}.piece` }],
      onSuccess: () => succeeded.push(label) });
  }
  const laneQueues = { ultraLight: writes.slice(), massive: [], light: [], heavy: [] };
  const original = writes.map(entry => ({ entry, job: entry.job, prefetched: entry.prefetched }));
  let sawRealStall = false;
  const snapshot = () => {
    const actual = buildActiveWriteTelemetrySnapshot({ activeWrites, activeWriteBytes, activeWriteMeta });
    if (concurrent && actual.stallFamily === 'family-a') sawRealStall = true;
    return avoid ? { ...actual, stallFamily: avoid } : actual;
  };
  const dispatch = dispatchArtifactWrites({ laneQueues,
    writeFsStrategy: { mode: 'generic', microCoalescing: micro,
      microBatchMaxCount: concurrent ? 1 : maxCount, microBatchMaxBytes: maxBytes },
    ultraLightWriteThresholdBytes: 64 * 1024,
    writeTailWorkerEnabled: false, writeTailWorkerMaxPending: 3,
    writeTailRescueEnabled: false, writeTailRescueMaxPending: 3, writeTailRescueStallSeconds: 15,
    writeTailRescueBoostIoTokens: 1, writeTailRescueBoostMemTokens: 1,
    adaptiveWriteConcurrencyEnabled: false, adaptiveWriteObserveIntervalMs: 0,
    adaptiveWriteQueuePendingThreshold: 1, adaptiveWriteQueueOldestWaitMsThreshold: 1200,
    adaptiveWriteQueueWaitP95MsThreshold: 750, adaptiveWriteStallScaleDownSeconds: 20,
    writeConcurrencyController: { getCurrentConcurrency: () => concurrent ? 2 : 1, observe: () => 1 },
    writeConcurrency: concurrent ? 2 : 1, hostConcurrency: 4, scheduler: null,
    effectiveAbortSignal: null,
    canDispatchEntryUnderHugeWritePolicy: entry => entry.label !== blocked || allow,
    activeWrites, activeWriteBytes, activeWriteMeta, hugeWriteState: { bytes: 0, families: new Set() },
    updateWriteInFlightTelemetry() {}, getLongestWriteStallSeconds: () => 0,
    getActiveWriteTelemetrySnapshot: snapshot, updateActiveWriteMeta,
    resolveEntryEstimatedBytes: entry => entry.estimatedBytes, resolveHugeWriteFamily: () => null,
    massiveWriteIoTokens: 2, massiveWriteMemTokens: 1, resolveArtifactWriteMemTokens: () => 0,
    outDir: process.cwd(), artifactMetrics: metrics, artifactFamilyLedger: ledger,
    artifactQueueDelaySamples: new Map(), updatePieceMetadata: label => metadata.push(label),
    formatBytes: String, logLine() {}, logWriteProgress: label => progress.push(label),
    writeHeartbeat: { start() {}, stop() {}, clearLabelAlerts() {} }
  });
  try {
    if (permanent) {
      await assert.rejects(dispatch, /queued writes became undispatchable/);
      assert.deepEqual(laneQueues.ultraLight.map(entry => entry.label), [blocked]);
      const retained = original.find(value => value.entry.label === blocked);
      assert.equal(laneQueues.ultraLight[0], retained.entry);
      assert.equal(retained.entry.job, retained.job, 'deferred work keeps its original closure');
      assert.equal(retained.entry.prefetched, retained.prefetched, 'deferred work keeps original prefetch ownership');
      assert.equal(metadata.includes(blocked), false);
    } else {
      await dispatch;
      assert.deepEqual(laneQueues.ultraLight, []);
      for (const entries of [executed, succeeded, registered, progress, metadata]) {
        assert.deepEqual([...entries].sort(), ['A', 'B', 'C'], 'every admitted job/publication callback runs exactly once');
      }
      assert.equal(metrics.size, 3);
      assert.equal([...ledger.values()].reduce((sum, entry) => sum + entry.completed, 0), 3);
      for (const { entry } of original) assert.equal(entry.job, null, 'only completed planner work retires its closure');
    }
    assert.equal(executed.length + laneQueues.ultraLight.length, 3, 'executed plus still-owned pending work is conserved');
    if (concurrent) assert.equal(sawRealStall, true, 'the real active writer telemetry chooses an avoided family');
  } finally { releaseActive(); }
};

await run();
await run({ avoid: 'family-b' });
await run({ avoid: 'family-a' });
await run({ micro: false, avoid: 'family-b' });
await run({ blocked: 'B' });
await run({ prefetch: true, avoid: 'family-b' });
await run({ maxCount: 1, maxBytes: 100 });
await run({ concurrent: true });
for (const blocked of ['A', 'B', 'C']) await run({ blocked, permanent: true });

const entries = [100, 100, 100].map((estimatedBytes, index) => ({ estimatedBytes, label: String(index), job() {} }));
const queue = entries.slice();
const selected = selectMicroWriteBatch(queue, { maxEntries: 2, maxBytes: 200 });
assert.deepEqual(selected.entries, entries.slice(0, 2));
assert.equal(selected.estimatedBytes, 200);
assert.deepEqual(queue, [entries[2]]);
const untouched = entries.slice(), failure = new Error('admission inspection failed');
assert.throws(() => selectMicroWriteBatch(untouched, { canSelect: entry => {
  if (entry === entries[1]) throw failure;
  return true;
} }), error => error === failure);
assert.deepEqual(untouched, entries, 'failed inspection cannot partially dequeue a batch');
console.log('Artifact micro-batches conserve deferred writers and exact publication ownership.');
