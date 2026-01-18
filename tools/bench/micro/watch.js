#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { createDebouncedScheduler } from '../../../src/index/build/watch.js';
import { formatStats, hrtimeMs, summarizeDurations } from './utils.js';

const argv = yargs(hideBin(process.argv))
  .option('bursts', {
    type: 'number',
    describe: 'Number of event bursts to measure',
    default: 5
  })
  .option('warmup', {
    type: 'number',
    describe: 'Warmup bursts discarded before measuring',
    default: 1
  })
  .option('burst-size', {
    type: 'number',
    describe: 'Events per burst',
    default: 1000
  })
  .option('debounce', {
    type: 'number',
    describe: 'Debounce window in ms',
    default: 75
  })
  .option('idle', {
    type: 'number',
    describe: 'Idle time between bursts in ms',
    default: 25
  })
  .option('json', {
    type: 'boolean',
    describe: 'Emit JSON output only',
    default: false
  })
  .option('out', {
    type: 'string',
    describe: 'Write JSON results to a file'
  })
  .help()
  .argv;

const bursts = Math.max(1, Math.floor(argv.bursts));
const warmupBursts = Math.max(0, Math.floor(argv.warmup));
const burstSize = Math.max(1, Math.floor(argv['burst-size']));
const debounceMs = Math.max(0, Math.floor(argv.debounce));
const idleMs = Math.max(0, Math.floor(argv.idle));

const results = {
  generatedAt: new Date().toISOString(),
  config: {
    bursts,
    warmupBursts,
    burstSize,
    debounceMs,
    idleMs
  },
  bursts: []
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let i = 0; i < bursts + warmupBursts; i += 1) {
  const measurement = await runBurst({ burstSize, debounceMs });
  if (i >= warmupBursts) {
    results.bursts.push(measurement);
  }
  if (idleMs > 0 && i < bursts + warmupBursts - 1) {
    await sleep(idleMs);
  }
}

const summary = summarize(results.bursts);
if (summary) results.summary = summary;

if (argv.out) {
  const outPath = path.resolve(argv.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`[watch] bursts=${bursts} size=${burstSize} debounce=${debounceMs}ms`);
  if (summary) {
    console.log(`- schedule: ${formatStats(summary.scheduleMs)}`);
    console.log(`- total:    ${formatStats(summary.totalMs)}`);
    if (summary.fireDelayMs.count) {
      console.log(`- fire:     ${formatStats(summary.fireDelayMs)}`);
    }
    console.log(`- cancels:  avg ${(summary.cancelMean || 0).toFixed(1)} per burst`);
  }
}

async function runBurst({ burstSize, debounceMs }) {
  let scheduleCount = 0;
  let cancelCount = 0;
  let fireCount = 0;
  let fireAt = null;
  let resolveRun;
  const runPromise = new Promise((resolve) => {
    resolveRun = resolve;
  });
  const scheduler = createDebouncedScheduler({
    debounceMs,
    onSchedule: () => {
      scheduleCount += 1;
    },
    onCancel: () => {
      cancelCount += 1;
    },
    onFire: () => {
      fireCount += 1;
      fireAt = process.hrtime.bigint();
    },
    onRun: async () => {
      resolveRun();
    }
  });

  const start = process.hrtime.bigint();
  for (let i = 0; i < burstSize; i += 1) {
    scheduler.schedule();
  }
  const scheduleMs = hrtimeMs(start);
  await runPromise;
  const totalMs = hrtimeMs(start);
  const fireDelayMs = fireAt ? Number(fireAt - start) / 1e6 : null;

  return {
    scheduleMs,
    totalMs,
    fireDelayMs,
    scheduleCount,
    cancelCount,
    fireCount
  };
}

function summarize(bursts) {
  if (!bursts.length) return null;
  const scheduleMs = summarizeDurations(bursts.map((entry) => entry.scheduleMs));
  const totalMs = summarizeDurations(bursts.map((entry) => entry.totalMs));
  const fireDelays = bursts.map((entry) => entry.fireDelayMs).filter((value) => Number.isFinite(value));
  const fireDelayMs = summarizeDurations(fireDelays);
  const cancelMean = bursts.reduce((sum, entry) => sum + entry.cancelCount, 0) / bursts.length;
  return {
    scheduleMs,
    totalMs,
    fireDelayMs,
    cancelMean
  };
}
