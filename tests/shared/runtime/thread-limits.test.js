#!/usr/bin/env node
import { resolveThreadLimits } from '../../../src/shared/threads.js';
import { planShardBatches } from '../../../src/index/build/shards.js';

const argv = { threads: 4 };
const rawArgv = ['--threads', '4'];
const envConfig = {};
const limits = resolveThreadLimits({ argv, rawArgv, envConfig, configConcurrency: null, importConcurrencyConfig: null });

if (limits.fileConcurrency !== 4) {
  console.error(`thread limits test failed: fileConcurrency ${limits.fileConcurrency} !== 4`);
  process.exit(1);
}
if (limits.cpuConcurrency !== limits.fileConcurrency) {
  console.error('thread limits test failed: cpuConcurrency not equal fileConcurrency');
  process.exit(1);
}

const items = [
  { id: 'a', weight: 8 },
  { id: 'b', weight: 7 },
  { id: 'c', weight: 6 },
  { id: 'd', weight: 5 }
];
const batches = planShardBatches(items, 2, { resolveWeight: (item) => item.weight });
if (batches.length !== 2) {
  console.error(`thread limits test failed: expected 2 batches, got ${batches.length}`);
  process.exit(1);
}
const sums = batches.map((batch) => batch.reduce((sum, item) => sum + item.weight, 0));
const sorted = sums.slice().sort((a, b) => b - a);
if (sorted[0] !== 13 || sorted[1] !== 13) {
  console.error(`thread limits test failed: batch sums ${sorted.join(',')} expected 13,13`);
  process.exit(1);
}

console.log('thread limits test passed');
