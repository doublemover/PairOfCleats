#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { buildLocalCacheKey } from '../../src/shared/cache-key.js';

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

const args = parseArgs();
const ops = Number(args.ops) || 200000;
const keys = Number(args.keys) || 20000;
const hitRate = Math.min(1, Math.max(0, Number(args.hitRate) || 0.85));
const iterations = Number(args.iterations) || 1;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const hitThreshold = Math.round(hitRate * 100);

const buildKeyBaseline = (id) => `key:${id}`;
const buildKeyCurrent = (id) => buildLocalCacheKey({
  namespace: 'bench-cache',
  payload: { id }
}).key;

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
