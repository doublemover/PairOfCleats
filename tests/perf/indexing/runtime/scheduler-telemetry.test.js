#!/usr/bin/env node
import { createBuildScheduler } from '../../../../src/shared/concurrency.js';

const scheduler = createBuildScheduler({
  cpuTokens: 1,
  ioTokens: 1,
  memoryTokens: 1,
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

console.log('scheduler telemetry test passed');
