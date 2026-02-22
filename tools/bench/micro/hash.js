#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { resolveXxhashBackend } from '../../../src/shared/hash/xxhash-backend.js';
import { formatStats, summarizeDurations } from './utils.js';

const argv = createCli({
  options: {
    size: {
      type: 'number',
      describe: 'Payload size in bytes',
      default: 1024 * 1024
    },
    iterations: {
      type: 'number',
      describe: 'Total iterations per backend',
      default: 2000
    },
    samples: {
      type: 'number',
      describe: 'Sample buckets for timing stats',
      default: 10
    },
    warmup: {
      type: 'number',
      describe: 'Warmup iterations per backend',
      default: 200
    },
    json: {
      type: 'boolean',
      describe: 'Emit JSON output only',
      default: false
    },
    out: {
      type: 'string',
      describe: 'Write JSON results to a file'
    }
  }
}).parse();

const size = Math.max(1, Math.floor(argv.size));
const iterations = Math.max(1, Math.floor(argv.iterations));
const samples = Math.max(1, Math.floor(argv.samples));
const warmup = Math.max(0, Math.floor(argv.warmup));

const payload = Buffer.alloc(size, 0x61);
const results = {
  generatedAt: new Date().toISOString(),
  sizeBytes: size,
  iterations,
  warmup,
  backends: {}
};

const wasmBackend = await resolveXxhashBackend({ backend: 'wasm' });
results.backends.wasm = await runBench('wasm', wasmBackend, { payload, iterations, samples, warmup });

const nativeBackend = await resolveXxhashBackend({ backend: 'native' });
if (nativeBackend?.name === 'native') {
  results.backends.native = await runBench('native', nativeBackend, { payload, iterations, samples, warmup });
} else {
  results.backends.native = { available: false };
}

if (argv.out) {
  const outPath = path.resolve(argv.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[hash] size=${size} bytes iterations=${iterations}`);
  printBackend('wasm', results.backends.wasm);
  if (results.backends.native.available === false) {
    console.error('- native: unavailable (install optional "@node-rs/xxhash" dependency)');
  } else {
    printBackend('native', results.backends.native);
  }
}

async function runBench(label, backend, { payload, iterations, samples, warmup }) {
  for (let i = 0; i < warmup; i += 1) {
    await backend.hash64(payload);
  }
  const timings = [];
  const perSample = Math.max(1, Math.floor(iterations / samples));
  const remainder = iterations - (perSample * samples);
  let totalMs = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    for (let j = 0; j < loops; j += 1) {
      await backend.hash64(payload);
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const bytesProcessed = payload.length * iterations;
  const mbPerSec = totalMs > 0 ? (bytesProcessed / (1024 * 1024)) / (totalMs / 1000) : 0;
  return {
    available: true,
    totalMs,
    mbPerSec,
    stats
  };
}

function printBackend(name, payload) {
  const stats = payload.stats || null;
  const rate = Number.isFinite(payload.mbPerSec) ? payload.mbPerSec.toFixed(1) : 'n/a';
  const summary = stats ? formatStats(stats) : 'n/a';
  console.error(`- ${name}: ${summary} | MB/sec ${rate}`);
}
