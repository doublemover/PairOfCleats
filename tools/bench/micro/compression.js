#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
const { default: yargs } = await import('yargs/yargs');
const { hideBin } = await import('yargs/helpers');
const { tryRequire } = await import('../../../src/shared/optional-deps.js');
const { formatStats, normalizeSampledBenchOptions } = await import('./utils.js');
const { runCompressionBenchmark } = await import('./compression-runner.js');
const { installedPackageVersion } = await import('../../../src/shared/installed-package-version.js');

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
const { iterations, requestedSamples: samples, warmup } = normalizeSampledBenchOptions(argv);
const entropy = argv.entropy;

const gzipBackend = {
  label: 'gzip',
  implementation: { name: 'node:zlib/gzip', version: process.versions.zlib || null, settings: { level: -1, policy: 'zlib-defaults' } },
  compress: async (buffer) => gzipSync(buffer),
  decompress: async (buffer) => gunzipSync(buffer)
};

const zstd = loadZstd();
const backends = [gzipBackend];
if (zstd) {
  backends.push({
    label: 'zstd',
    implementation: { name: '@mongodb-js/zstd', version: installedPackageVersion('@mongodb-js/zstd'),
      settings: { level: null, policy: 'library-default-unobserved' } },
    compress: async (buffer) => zstd.compress(buffer),
    decompress: async (buffer) => zstd.decompress(buffer)
  });
}

const results = await runCompressionBenchmark({ sizes, entropy, iterations, samples, warmup, backends });

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
      console.error(`  compress buckets:   ${compress}`);
      console.error(`  decompress buckets: ${decompress}`);
    }
  }
  if (!zstd) {
    console.error('- zstd: unavailable (install optional "@mongodb-js/zstd" dependency)');
  }
}

function parseSizes(raw) {
  const values = String(raw || '').split(',').map(Number);
  if (values.some(value => !Number.isSafeInteger(value) || value < 1)) throw new RangeError('Invalid compression payload sizes.');
  return values;
}

function loadZstd() {
  const result = tryRequire('@mongodb-js/zstd');
  if (!result.ok) return null;
  return result.mod;
}
