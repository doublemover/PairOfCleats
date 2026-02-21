#!/usr/bin/env node
import { createBuildScheduler } from '../../../../src/shared/concurrency.js';

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
  traceIntervalMs: 100,
  queues: {
    telemetry: { priority: 10 }
  }
});

const tasks = [];
for (let i = 0; i < 3; i += 1) {
  tasks.push(
    scheduler.schedule('telemetry', { cpu: 1 }, async () => i)
  );
}
await Promise.all(tasks);
scheduler.setTelemetryOptions({ stage: 'telemetry-verify' });

const stats = scheduler.stats();
const queueStats = stats?.queues?.telemetry;
if (!queueStats) {
  console.error('scheduler telemetry test failed: missing queue stats');
  process.exit(1);
}
if (stats.counters.scheduled !== 3 || queueStats.scheduled !== 3) {
  console.error('scheduler telemetry test failed: scheduled counters mismatch');
  process.exit(1);
}
if (stats.counters.completed !== 3 || queueStats.completed !== 3) {
  console.error('scheduler telemetry test failed: completed counters mismatch');
  process.exit(1);
}
if (!stats.tokens?.cpu || stats.tokens.cpu.total !== 1) {
  console.error('scheduler telemetry test failed: token totals missing');
  process.exit(1);
}
if (!Number.isFinite(Number(stats?.adaptive?.intervalMs)) || Number(stats.adaptive.intervalMs) < 50) {
  console.error('scheduler telemetry test failed: adaptive interval telemetry missing');
  process.exit(1);
}
if (!['steady', 'burst', 'settle'].includes(String(stats?.adaptive?.mode || ''))) {
  console.error('scheduler telemetry test failed: adaptive mode telemetry missing');
  process.exit(1);
}
if (
  !Number.isFinite(Number(stats?.adaptive?.smoothedUtilization))
  || !Number.isFinite(Number(stats?.adaptive?.smoothedPendingPressure))
  || !Number.isFinite(Number(stats?.adaptive?.smoothedStarvation))
) {
  console.error('scheduler telemetry test failed: adaptive smoothing telemetry missing');
  process.exit(1);
}
const trace = stats?.telemetry?.schedulingTrace;
if (!Array.isArray(trace) || trace.length < 2) {
  console.error('scheduler telemetry test failed: expected scheduling trace samples');
  process.exit(1);
}
const latest = trace[trace.length - 1];
if (!Number.isFinite(Number(latest?.tokens?.cpu?.total)) || !Number.isFinite(Number(latest?.tokens?.cpu?.used))) {
  console.error('scheduler telemetry test failed: missing token total/used trace fields');
  process.exit(1);
}

console.log('scheduler telemetry test passed');
