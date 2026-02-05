#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import PQueue from 'p-queue';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const percentile = (values, pct) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return sorted[idx];
};

const args = parseArgs();
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const cpuTasks = Number(args['cpu-tasks']) || 64;
const ioTasks = Number(args['io-tasks']) || 16;
const cpuMs = Number(args['cpu-ms']) || 8;
const ioMs = Number(args['io-ms']) || 4;
const cpuConcurrency = Number(args['cpu-concurrency']) || 4;
const ioConcurrency = Number(args['io-concurrency']) || 2;

const runBaseline = async () => {
  const queue = new PQueue({ concurrency: cpuConcurrency });
  const waits = [];
  const tasks = [];
  for (let i = 0; i < cpuTasks; i += 1) {
    tasks.push(queue.add(async () => {
      await sleep(cpuMs);
    }));
  }
  for (let i = 0; i < ioTasks; i += 1) {
    const enqueuedAt = performance.now();
    tasks.push(queue.add(async () => {
      waits.push(performance.now() - enqueuedAt);
      await sleep(ioMs);
    }));
  }
  await Promise.all(tasks);
  return waits;
};

const runScheduler = async () => {
  const scheduler = createBuildScheduler({
    cpuTokens: cpuConcurrency,
    ioTokens: ioConcurrency,
    memoryTokens: 0,
    starvationMs: 500,
    queues: {
      cpu: { priority: 20 },
      io: { priority: 10 }
    }
  });
  const waits = [];
  const tasks = [];
  for (let i = 0; i < cpuTasks; i += 1) {
    tasks.push(scheduler.schedule('cpu', { cpu: 1 }, async () => {
      await sleep(cpuMs);
    }));
  }
  for (let i = 0; i < ioTasks; i += 1) {
    const enqueuedAt = performance.now();
    tasks.push(scheduler.schedule('io', { io: 1 }, async () => {
      waits.push(performance.now() - enqueuedAt);
      await sleep(ioMs);
    }));
  }
  await Promise.all(tasks);
  return waits;
};

const summarize = (label, waits, baseline = null) => {
  const avg = waits.reduce((sum, value) => sum + value, 0) / (waits.length || 1);
  const p95 = percentile(waits, 0.95);
  const parts = [
    `avg=${avg.toFixed(2)}ms`,
    `p95=${p95.toFixed(2)}ms`,
    `samples=${waits.length}`
  ];
  if (baseline) {
    const baselineAvg = baseline.avg;
    const delta = avg - baselineAvg;
    const pct = baselineAvg > 0 ? (delta / baselineAvg) * 100 : 0;
    parts.push(`delta=${delta.toFixed(2)}ms (${pct.toFixed(1)}%)`);
  }
  console.log(`[bench] scheduler-io-starvation ${label} ${parts.join(' ')}`);
  return { avg, p95 };
};

let baseline = null;
let current = null;
if (mode !== 'current') {
  const waits = await runBaseline();
  baseline = summarize('baseline', waits);
}
if (mode !== 'baseline') {
  const waits = await runScheduler();
  current = summarize('current', waits, baseline);
}

if (mode === 'compare' && baseline && current) {
  const delta = current.avg - baseline.avg;
  const pct = baseline.avg > 0 ? (delta / baseline.avg) * 100 : 0;
  console.log(`[bench] delta avg=${delta.toFixed(2)}ms (${pct.toFixed(1)}%)`);
}
