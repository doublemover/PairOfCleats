#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { tryRequire } from '../../../src/shared/optional-deps.js';
import { formatStats, summarizeDurations } from './utils.js';

const argv = yargs(hideBin(process.argv))
  .option('sizes', {
    type: 'string',
    describe: 'Comma-separated payload sizes in bytes',
    default: '65536,262144,1048576'
  })
  .option('iterations', {
    type: 'number',
    describe: 'Total iterations per backend per size',
    default: 200
  })
  .option('samples', {
    type: 'number',
    describe: 'Sample buckets for timing stats',
    default: 10
  })
  .option('warmup', {
    type: 'number',
    describe: 'Warmup iterations per backend per size',
    default: 20
  })
  .option('entropy', {
    type: 'number',
    describe: 'Entropy ratio (0 = highly compressible, 1 = random)',
    default: 0.25
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

const sizes = parseSizes(argv.sizes);
const iterations = Math.max(1, Math.floor(argv.iterations));
const samples = Math.max(1, Math.floor(argv.samples));
const warmup = Math.max(0, Math.floor(argv.warmup));
const entropy = clamp(Number(argv.entropy) || 0, 0, 1);

const results = {
  generatedAt: new Date().toISOString(),
  sizes,
  iterations,
  warmup,
  entropy,
  backends: {}
};

const gzipBackend = {
  label: 'gzip',
  compress: async (buffer) => gzipSync(buffer),
  decompress: async (buffer) => gunzipSync(buffer)
};

const zstd = loadZstd();
const backends = [gzipBackend];
if (zstd) {
  backends.push({
    label: 'zstd',
    compress: async (buffer) => zstd.compress(buffer),
    decompress: async (buffer) => zstd.decompress(buffer)
  });
}

for (const backend of backends) {
  results.backends[backend.label] = {};
  for (const size of sizes) {
    const payload = buildPayload(size, entropy);
    const summary = await runBench(backend, payload, { iterations, samples, warmup });
    results.backends[backend.label][String(size)] = summary;
  }
}

if (!zstd) {
  results.backends.zstd = { available: false };
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const backend of backends) {
    console.error(`[compression:${backend.label}]`);
    const sizesEntries = results.backends[backend.label] || {};
    for (const size of sizes) {
      const entry = sizesEntries[String(size)];
      if (!entry) continue;
      const ratio = Number.isFinite(entry.ratio) ? entry.ratio.toFixed(3) : 'n/a';
      const compress = entry.compress?.stats ? formatStats(entry.compress.stats) : 'n/a';
      const decompress = entry.decompress?.stats ? formatStats(entry.decompress.stats) : 'n/a';
      console.error(`- size=${size} ratio=${ratio}`);
      console.error(`  compress:   ${compress}`);
      console.error(`  decompress: ${decompress}`);
    }
  }
  if (!zstd) {
    console.error('- zstd: unavailable (install optional "@mongodb-js/zstd" dependency)');
  }
}

function parseSizes(raw) {
  return String(raw || '')
    .split(',')
    .map((value) => Math.max(1, Math.floor(Number(value))))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildPayload(size, entropy) {
  const base = Buffer.alloc(size);
  if (entropy <= 0) {
    base.fill(0x61);
    return base;
  }
  for (let i = 0; i < size; i += 1) {
    if (Math.random() < entropy) {
      base[i] = Math.floor(Math.random() * 256);
    } else {
      base[i] = 0x61 + (i % 26);
    }
  }
  return base;
}

function loadZstd() {
  const result = tryRequire('@mongodb-js/zstd');
  if (!result.ok) return null;
  return result.mod;
}

async function runBench(backend, payload, { iterations, samples, warmup }) {
  const baseCompressed = await backend.compress(payload);
  const ratio = baseCompressed.length / payload.length;
  await warmupRun(backend.compress, payload, warmup);
  await warmupRun(backend.decompress, baseCompressed, warmup);

  const compress = await runTimed(() => backend.compress(payload), { iterations, samples });
  const decompress = await runTimed(() => backend.decompress(baseCompressed), { iterations, samples });

  return {
    payloadBytes: payload.length,
    compressedBytes: baseCompressed.length,
    ratio,
    compress,
    decompress
  };
}

async function warmupRun(fn, payload, iterations) {
  for (let i = 0; i < iterations; i += 1) {
    await fn(payload);
  }
}

async function runTimed(fn, { iterations, samples }) {
  const timings = [];
  const perSample = Math.max(1, Math.floor(iterations / samples));
  const remainder = iterations - (perSample * samples);
  let totalMs = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    for (let j = 0; j < loops; j += 1) {
      await fn();
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  return {
    totalMs,
    stats: summarizeDurations(timings)
  };
}
