#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
// Usage: node tools/bench/vfs/io-batching.js --files 1000 --size 256 --batch 50 --json
import path from 'node:path';
import { runIoBatching } from './io-batching-owner.js';
const { createCli } = await import('../../../src/shared/cli.js');
const { formatStats, writeJsonWithDir } = await import('../micro/utils.js');

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'io-batching',
  argv: ['node', 'io-batching', ...rawArgs],
  options: {
    files: { type: 'number', default: 1000, describe: 'Number of files to write' },
    size: { type: 'number', default: 256, describe: 'Bytes per write' },
    batch: { type: 'number', default: 50, describe: 'Batch size for queued writes' },
    mode: { type: 'string', default: 'both', choices: ['both', 'unbatched', 'batched'], describe: 'both|unbatched|batched' },
    outDir: { type: 'string', describe: 'Parent for an exclusively created run directory (defaults to temp)' },
    keep: { type: 'boolean', default: false, describe: 'Keep output files' },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const fileCount = clampInt(argv.files, 1, 1000);
const payloadSize = clampInt(argv.size, 1, 256);
const batchSize = clampInt(argv.batch, 1, 50);
const mode = String(argv.mode || 'both').toLowerCase();

const results = await runIoBatching({ fileCount, payloadSize, batchSize, mode,
  outDir: argv.outDir ? path.resolve(String(argv.outDir)) : null, keep: argv.keep });

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[io-batching] files=${fileCount} size=${payloadSize} batch=${batchSize}`);
  if (results.bench.unbatched) printBench('unbatched', results.bench.unbatched);
  if (results.bench.batched) printBench('batched', results.bench.batched);
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const rate = Number.isFinite(bench.bytesPerSec) ? (bench.bytesPerSec / (1024 * 1024)).toFixed(2) : 'n/a';
  console.error(`- ${label}: ${stats} | MB/sec ${rate}`);
}
