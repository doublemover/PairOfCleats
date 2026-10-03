#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { buildLocalCacheKey, createLocalCacheKeyBuilder } from '../../src/shared/cache-key.js';
import { createBoundedWriterQueue } from '../build/embeddings/writer-queue.js';
import { parseSimpleBenchArgs } from './shared.js';

const args = parseSimpleBenchArgs();
const parseNumberOption = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};
const parseBooleanOption = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const ops = parseNumberOption(args.ops, 200000) || 200000;
const keys = parseNumberOption(args.keys, 20000) || 20000;
const hitRate = Math.min(1, Math.max(0, parseNumberOption(args.hitRate, 0.85)));
const iterations = parseNumberOption(args.iterations, 1) || 1;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const includeWriter = parseBooleanOption(args.writer, true);
const writerOps = parseNumberOption(args.writerOps, 5000) || 5000;
const writerDelayMs = parseNumberOption(args.writerDelayMs, 0) || 0;
const writerMaxPending = parseNumberOption(args.writerMaxPending, 2) || 2;

const hitThreshold = Math.round(hitRate * 100);
const currentKeyBuilder = createLocalCacheKeyBuilder({ namespace: 'bench-cache' });

const buildKeyBaseline = (id) => buildLocalCacheKey({
  namespace: 'bench-cache',
  payload: { id }
}).key;
const buildKeyCurrent = (id) => currentKeyBuilder.keyForProperty('id', id);

const runBench = (label, buildKey) => {
  const cache = new Map();
  for (let i = 0; i < keys; i += 1) {
    cache.set(buildKey(i), i);
  }
  let hits = 0;
  let misses = 0;
  let total = 0;
  const start = performance.now();
  for (let round = 0; round < iterations; round += 1) {
    for (let i = 0; i < ops; i += 1) {
      const isHit = (i % 100) < hitThreshold;
      const id = isHit ? (i % keys) : (keys + i);
      const key = buildKey(id);
      const value = cache.get(key);
      if (value !== undefined) hits += 1;
      else misses += 1;
      total += 1;
    }
  }
  const durationMs = performance.now() - start;
  const throughput = total ? (total / (durationMs / 1000)) : 0;
  return { label, durationMs, throughput, total, hits, misses };
};

const printResult = (result) => {
  console.log(
    `[bench] ${result.label} duration=${result.durationMs.toFixed(1)}ms `
    + `throughput=${result.throughput.toFixed(1)}/s `
    + `hits=${result.hits} misses=${result.misses} amount=${result.total}`
  );
};

const printDelta = (baseline, current) => {
  const deltaMs = current.durationMs - baseline.durationMs;
  const deltaPct = baseline.durationMs ? (deltaMs / baseline.durationMs) * 100 : 0;
  const deltaThroughput = current.throughput - baseline.throughput;
  const throughputPct = baseline.throughput ? (deltaThroughput / baseline.throughput) * 100 : 0;
  console.log(
    `[bench] delta duration=${deltaMs.toFixed(1)}ms (${deltaPct.toFixed(1)}%) `
    + `throughput=${deltaThroughput.toFixed(1)}/s (${throughputPct.toFixed(1)}%) `
    + `amount=${current.total}`
  );
};

let baseline = null;
let current = null;

if (mode !== 'current') {
  baseline = runBench('baseline', buildKeyBaseline);
  printResult(baseline);
}

if (mode !== 'baseline') {
  current = runBench('current', buildKeyCurrent);
  printResult(current);
  if (baseline) {
    printDelta(baseline, current);
  }
}

if (includeWriter) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const runWriterBench = async () => {
    const writer = createBoundedWriterQueue({
      scheduleIo: (fn) => Promise.resolve().then(async () => {
        if (writerDelayMs > 0) await delay(writerDelayMs);
        return fn();
      }),
      maxPending: writerMaxPending
    });

    const start = performance.now();
    for (let i = 0; i < writerOps; i += 1) {
      await writer.enqueue(async () => {});
    }
    await writer.onIdle();
    const durationMs = performance.now() - start;
    const throughput = writerOps ? (writerOps / (durationMs / 1000)) : 0;
    const stats = writer.stats();
    console.log(
      `[bench] writer duration=${durationMs.toFixed(1)}ms `
      + `throughput=${throughput.toFixed(1)}/s `
      + `ops=${writerOps} maxPending=${stats.maxPending} waits=${stats.waits} peakPending=${stats.peakPending}`
    );
  };

  await runWriterBench();
}
