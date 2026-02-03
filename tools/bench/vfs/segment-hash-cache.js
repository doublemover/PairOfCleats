#!/usr/bin/env node
// Usage: node tools/bench/vfs/segment-hash-cache.js --segments 10000 --unique 2000 --size 512 --json
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { checksumString } from '../../../src/shared/hash.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'segment-hash-cache',
  argv: ['node', 'segment-hash-cache', ...rawArgs],
  options: {
    segments: { type: 'number', default: 10000, describe: 'Total segments to hash' },
    unique: { type: 'number', default: 2000, describe: 'Unique segments in the pool' },
    size: { type: 'number', default: 512, describe: 'Segment size in bytes' },
    samples: { type: 'number', default: 10, describe: 'Sample buckets for timing stats' },
    seed: { type: 'number', default: 1 },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const segmentsCount = clampInt(argv.segments, 1, 10000);
const uniqueCount = Math.max(1, Math.min(segmentsCount, clampInt(argv.unique, 1, 2000)));
const segmentSize = clampInt(argv.size, 8, 512);
const samples = clampInt(argv.samples, 1, 10);
const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;

const segmentPool = buildSegments({ uniqueCount, segmentSize, seed });
const segments = buildSegmentSequence({ segmentsCount, segmentPool, seed: seed + 3 });

await checksumString('warmup');

const coldBench = await runHashBench({
  segments,
  samples,
  useCache: false
});

const cachedBench = await runHashBench({
  segments,
  samples,
  useCache: true
});

const results = {
  generatedAt: new Date().toISOString(),
  segments: segments.length,
  uniqueSegments: uniqueCount,
  segmentSize,
  samples,
  bench: {
    noCache: coldBench,
    withCache: cachedBench
  }
};

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[segment-hash-cache] segments=${segments.length} unique=${uniqueCount}`);
  printBench('no-cache', coldBench);
  printBench('with-cache', cachedBench);
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function createRng(seedValue) {
  let state = (seedValue >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomText(bytes, rng) {
  const chars = new Array(bytes);
  for (let i = 0; i < bytes; i += 1) {
    const code = 97 + Math.floor(rng() * 26);
    chars[i] = String.fromCharCode(code);
  }
  return chars.join('');
}

function buildSegments({ uniqueCount, segmentSize, seed }) {
  const rng = createRng(seed);
  const segments = new Array(uniqueCount);
  for (let i = 0; i < uniqueCount; i += 1) {
    const fileIndex = i % 250;
    const rangeStart = i * 13;
    const rangeEnd = rangeStart + segmentSize;
    const lang = i % 2 === 0 ? 'typescript' : 'python';
    const ext = lang === 'typescript' ? 'ts' : 'py';
    segments[i] = {
      key: `file-${fileIndex}|${rangeStart}-${rangeEnd}|${ext}|${lang}`,
      text: randomText(segmentSize, rng)
    };
  }
  return segments;
}

function buildSegmentSequence({ segmentsCount, segmentPool, seed }) {
  const rng = createRng(seed);
  const segments = new Array(segmentsCount);
  for (let i = 0; i < segmentsCount; i += 1) {
    segments[i] = segmentPool[Math.floor(rng() * segmentPool.length)];
  }
  return segments;
}

async function runHashBench({ segments, samples, useCache }) {
  const cache = new Map();
  let cacheHits = 0;
  const timings = [];
  const totalIterations = segments.length;
  const perSample = Math.max(1, Math.floor(totalIterations / samples));
  const remainder = totalIterations - perSample * samples;
  let totalMs = 0;
  let index = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    for (let j = 0; j < loops; j += 1) {
      const segment = segments[index];
      index += 1;
      if (useCache) {
        const cached = cache.get(segment.key);
        if (cached) {
          cacheHits += 1;
          continue;
        }
      }
      const digest = await checksumString(segment.text);
      if (useCache) {
        cache.set(segment.key, digest.value);
      }
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const opsPerSec = totalMs > 0 ? totalIterations / (totalMs / 1000) : 0;
  return {
    totalMs,
    opsPerSec,
    stats,
    cacheHits,
    cacheSize: cache.size
  };
}

function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const ops = Number.isFinite(bench.opsPerSec) ? bench.opsPerSec.toFixed(1) : 'n/a';
  const hits = Number.isFinite(bench.cacheHits) ? bench.cacheHits : 0;
  console.error(`- ${label}: ${stats} | ops/sec ${ops} | cacheHits ${hits}`);
}
