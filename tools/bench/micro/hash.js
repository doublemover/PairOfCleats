#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs';
import path from 'node:path';
const { createCli } = await import('../../../src/shared/cli.js');
const { resolveXxhashBackend } = await import('../../../src/shared/hash/xxhash-backend.js');
const { formatStats, normalizeSampledBenchOptions } = await import('./utils.js');
const { runHashBenchmark } = await import('./hash-runner.js');

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

const size = argv.size;
if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('Invalid hash payload size.');
const { iterations, requestedSamples: samples, warmup } = normalizeSampledBenchOptions(argv);

const payload = 'a'.repeat(size);
const results = {
  schemaVersion: 2,
  kind: 'hash-backend-microbenchmark',
  generatedAt: new Date().toISOString(),
  sizeBytes: size,
  iterations,
  requestedSamples: samples,
  warmup,
  backends: {}
};

const wasmBackend = await resolveXxhashBackend({ backend: 'wasm' });
results.backends.wasm = await runHashBenchmark(wasmBackend, payload, { iterations, samples, warmup });

const nativeBackend = await resolveXxhashBackend({ backend: 'native' });
if (nativeBackend?.name === 'native') {
  results.backends.native = await runHashBenchmark(nativeBackend, payload, { iterations, samples, warmup });
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

function printBackend(name, payload) {
  const stats = payload.stats || null;
  const rate = Number.isFinite(payload.mbPerSec) ? payload.mbPerSec.toFixed(1) : 'n/a';
  const summary = stats ? formatStats(stats) : 'n/a';
  console.error(`- ${name}: bucket ${summary} | MB/sec ${rate}`);
}
