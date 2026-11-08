import assert from 'node:assert/strict';
import { getMetricsRegistry, observeWorkerTaskDuration, setWorkerGcPressure } from '../../../src/shared/metrics/core.js';

// UNVALIDATED: the real process registry and encoder, synthetic identities.
// These are cardinality/count controls, not allocation or throughput evidence.
const histogramName = 'pairofcleats_worker_task_duration_seconds';
const gaugeName = 'pairofcleats_worker_gc_pressure_ratio';
const registry = getMetricsRegistry();
const snapshot = async () => new Map((await registry.getMetricsAsJSON()).map(metric => [metric.name, metric]));
const record = worker => {
  observeWorkerTaskDuration({ pool: 'tokenize', task: 'tokenize', worker, status: 'ok', seconds: 0.125 });
  setWorkerGcPressure({ pool: 'tokenize', worker, stage: 'stage1', value: 0.5 });
};
record('generation-0');
const initial = await snapshot();
const initialBytes = Buffer.byteLength(JSON.stringify([initial.get(histogramName), initial.get(gaugeName)]));
for (let index = 1; index < 2048; index++) record(`generation-${index}`);
const after = await snapshot(), histogram = after.get(histogramName), gauge = after.get(gaugeName);
assert.equal(histogram.values.length, initial.get(histogramName).values.length,
  'sequential worker identities cannot add histogram samples/families');
assert.equal(histogram.values.length, 15, 'existing twelve buckets, infinity, sum and count for one aggregate label set');
assert.equal(histogram.values.find(value => value.metricName === `${histogramName}_count`).value, 2048);
assert.equal(histogram.values.find(value => value.metricName === `${histogramName}_sum`).value, 256);
assert.ok(histogram.values.every(value => value.labels.worker === 'all'));
assert.equal(gauge.values.length, 1); assert.equal(gauge.values[0].value, 0.5);
assert.equal(gauge.values[0].labels.worker, 'all');
const afterBytes = Buffer.byteLength(JSON.stringify([histogram, gauge]));
// Only counter digit widths change. This does not estimate retained native/JS heap.
assert.ok(afterBytes - initialBytes < 128, 'serialized metric size cannot grow with retired identity strings');

let workerReads = 0;
const input = { pool: 'tokenize', task: 'tokenize', status: 'error', seconds: 0.25, stage: 'stage1', value: 0.25,
  get worker() { workerReads++; throw new Error('aggregate metrics do not inspect arbitrary raw identity'); } };
observeWorkerTaskDuration(input); setWorkerGcPressure(input);
assert.equal(workerReads, 0);
const completed = await snapshot(), values = completed.get(histogramName).values;
assert.equal(values.filter(value => value.metricName === `${histogramName}_count`).reduce((sum, value) => sum + value.value, 0), 2049);
assert.equal(values.filter(value => value.metricName === `${histogramName}_sum`).reduce((sum, value) => sum + value.value, 0), 256.25);
assert.equal(completed.get(gaugeName).values[0].value, 0.25, 'gauge is latest observation, not a lifetime sum');
console.log('worker metric aggregate cardinality and retained lifetime totals controls passed');
