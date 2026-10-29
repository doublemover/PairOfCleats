import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWorkerProcessCoordinator } from '../../../src/index/build/workers/pool/worker-coordination.js';
import { collectRuntimeResourceEvidence } from '../../../src/index/build/runtime/receipt.js';
import { buildDenseVectors } from '../../../src/index/build/postings/dense-vectors.js';
import { createQuantizationEvidence } from '../../../src/index/build/postings/quantization-evidence.js';
import { getMetricsRegistry, observeWorkerTaskDuration } from '../../../src/shared/metrics/core.js';
import { quantizeVec } from '../../../src/index/embedding.js';

const clock = Date.now; let pressureSamples = 0;
Date.now = () => 1000;
const pool = new EventEmitter(); pool.threads = [{ threadId: 1 }, { threadId: 2 }];
const coordinator = createWorkerProcessCoordinator({
  withPooledPayloadMeta: (_pool, assign, consume) => { const value = {}; assign(value); return consume(value); },
  observeWorkerTaskDuration, setStageGcPressure: () => {}, updatePressureState: () => {},
  maybeReduceWorkersOnPressure: async () => {},
  readProcessPressureSample: () => { pressureSamples++; return { heapUtilization: 0.2, rssPressure: 0.2, pressureRatio: 0.2 }; }
});
try {
  coordinator.attachPoolListeners(pool);
  for (const [threadId, task, durationMs] of [[1, 'tokenize', 2], [2, 'analyze', 3], [1, 'quantize', 4], [2, 'analyze', 5]]) {
    pool.emit('message', { type: 'worker-task-start', threadId, task });
    pool.emit('message', { type: 'worker-task', threadId, task, status: 'ok', durationMs });
  }
  assert.equal(pressureSamples, 1, 'pressure sampling remains throttled');
  const workers = coordinator.gcPressureStats().workers;
  assert.deepEqual(workers.map(row => [row.worker, row.taskCompletions, row.lastDurationMs]), [['1', 2, 4], ['2', 2, 5]]);
  assert.equal(coordinator.busyStats(pool).completedTasks, 4);
  assert.equal(coordinator.busyStats(pool).workerWallMs, 14);
} finally { Date.now = clock; }
const metric = (await getMetricsRegistry().getMetricsAsJSON()).find(row => row.name === 'pairofcleats_worker_task_duration_seconds');
assert.equal(metric.values.find(row => row.metricName.endsWith('_count') && row.labels.task === 'analyze').value, 2);
assert.ok(metric.values.every(row => row.labels.worker === 'all'));

const shared = { stats: () => ({ busy: { completedTasks: 999 }, backend: 'worker' }), getExecutionBackend: () => 'worker' };
const runtime = { workerPool: shared, quantizePool: shared };
assert.equal(collectRuntimeResourceEvidence(runtime).workers.quantizationExecution, 'not-yet-observed',
  'tokenize-only work in the shared pool cannot certify quantization');
const chunks = [{ embedding: [0.25, -0.25], embed_doc: null, embed_code: null }];
for (const route of ['inline', 'worker-pool', 'process-pool', 'fallback', 'cancelled', 'prequantized']) {
  const evidence = createQuantizationEvidence(); runtime.quantizationObservations = evidence;
  const controller = new AbortController();
  const worker = route === 'inline' || route === 'prequantized' ? null : {
    getExecutionBackend: () => route === 'process-pool' ? 'process' : 'worker',
    runQuantize: async ({ vectors }) => {
      if (route === 'cancelled') { controller.abort(); throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); }
      if (route === 'fallback') throw new Error('ordinary worker failure');
      return vectors.map(vector => quantizeVec(vector));
    }
  };
  const input = { chunks: route === 'prequantized' ? [{ embedding_u8: new Uint8Array([128, 127]), embed_doc: null, embed_code: null }] : chunks,
    quantizePool: worker, quantizationObservations: evidence, abortSignal: controller.signal };
  if (route === 'cancelled') {
    await assert.rejects(buildDenseVectors(input), { name: 'AbortError' });
    assert.equal(collectRuntimeResourceEvidence(runtime).workers.quantizationExecution, 'not-yet-observed');
    assert.equal(evidence.attempts['worker-pool:cancelled'], 1);
  } else {
    const result = await buildDenseVectors(input);
    assert.equal(result.quantizedVectors.length, 1);
    assert.equal(collectRuntimeResourceEvidence(runtime).workers.quantizationExecution, route === 'fallback' ? 'inline' : route);
    assert.equal(evidence.rows, 1);
    if (route === 'fallback') assert.equal(evidence.attempts['worker-pool:failed'], 1);
  }
}
const mixed = createQuantizationEvidence(); runtime.quantizationObservations = mixed;
await buildDenseVectors({ chunks, quantizationObservations: mixed });
await buildDenseVectors({ chunks, quantizationObservations: mixed, quantizePool: {
  getExecutionBackend: () => 'process', runQuantize: async ({ vectors }) => vectors.map(vector => quantizeVec(vector)) } });
assert.equal(collectRuntimeResourceEvidence(runtime).workers.quantizationExecution, 'mixed');
assert.deepEqual(mixed.routes, { inline: 1, 'process-pool': 1 });
console.log('Actual dense producer outcomes and bounded per-task metrics stay independent of shared-pool availability and pressure samples.');
