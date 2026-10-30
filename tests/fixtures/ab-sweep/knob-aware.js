import assert from 'node:assert/strict';
import { BENCH_OBSERVATION_VERSION, BENCH_SWEEP_KNOBS } from '../../../tools/bench/runner-observation.js';
import { benchmarkFingerprint } from '../../../tools/bench/runner-workload.js';

const config = JSON.parse(process.env.PAIROFCLEATS_TEST_CONFIG || '{}');
const cpu = Number(process.env.PAIROFCLEATS_SCHEDULER_CPU || 1);
const workers = Number(process.env.PAIROFCLEATS_WORKER_POOL_MAX_WORKERS || 1);
const writes = Number(config.indexing?.artifacts?.writeConcurrency || 1);
const partitions = cpu * workers * writes;
assert.ok(Number.isSafeInteger(partitions) && partitions > 0 && partitions <= 1024);
let checksum = 0;
for (let partition = 0; partition < partitions; partition++) {
  for (let i = partition; i < 1000; i += partitions) checksum += i;
}
assert.equal(checksum, 499500);
console.log('[bench] baseline duration=10.0ms throughput=100.0/s amount=1000');
console.log('[bench] current duration=8.0ms throughput=125.0/s amount=1000');
console.log('[bench] delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000');
const knobs = Object.fromEntries(BENCH_SWEEP_KNOBS.map(key => [key, { state: 'unsupported' }]));
Object.assign(knobs, { cpuTokens: { state: 'applied', value: cpu }, workerCounts: { state: 'applied', value: workers },
  writeConcurrency: { state: 'applied', value: writes } });
console.log(JSON.stringify({ benchmarkObservation: { version: BENCH_OBSERVATION_VERSION, scope: 'fixture',
  workload: { id: 'partitioned-checksum', producerVersion: '1', units: 1000,
    dataIdentity: benchmarkFingerprint({ range: [0, 999] }), configurationIdentity: benchmarkFingerprint({ algorithm: 'partitioned-sum-v1' }) },
  correctness: { state: 'passed', checks: ['checksum-equals-499500'] },
  // A deliberate fixture ranking checks selection. This is not real latency.
  metrics: { durationMs: 1000 / partitions }, knobs },
timings: { durationMs: 8, stages: { parse: { durationMs: 5 }, infer: { durationMs: 4 }, write: { durationMs: 3 } },
  artifacts: [{ path: 'chunk_meta.json', durationMs: 4, queueDelayMs: 2 }],
  scheduler: { trace: [{ atMs: 1, utilization: { overall: 0.7 } }, { atMs: 2, utilization: { overall: 0.8 } }] } } }));
