#!/usr/bin/env node
// Usage: node tools/bench/vfs/io-batching.js --files 1000 --size 256 --batch 50 --json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'io-batching',
  argv: ['node', 'io-batching', ...rawArgs],
  options: {
    files: { type: 'number', default: 1000, describe: 'Number of files to write' },
    size: { type: 'number', default: 256, describe: 'Bytes per write' },
    batch: { type: 'number', default: 50, describe: 'Batch size for queued writes' },
    mode: { type: 'string', default: 'both', describe: 'both|unbatched|batched' },
    outDir: { type: 'string', describe: 'Output directory (defaults to temp)' },
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

const baseDir = argv.outDir
  ? path.resolve(String(argv.outDir))
  : path.join(os.tmpdir(), `poc-vfs-io-batching-${Date.now()}`);

const payload = Buffer.alloc(payloadSize, 0x61);
const results = {
  generatedAt: new Date().toISOString(),
  baseDir,
  files: fileCount,
  payloadSize,
  batchSize,
  bench: {}
};

try {
  if (mode === 'both' || mode === 'unbatched') {
    results.bench.unbatched = await runWriteBench({
      label: 'unbatched',
      dir: path.join(baseDir, 'unbatched'),
      fileCount,
      payload
    });
  }

  if (mode === 'both' || mode === 'batched') {
    results.bench.batched = await runWriteBench({
      label: 'batched',
      dir: path.join(baseDir, 'batched'),
      fileCount,
      payload,
      batchSize
    });
  }
} finally {
  if (!argv.keep) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

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

async function runWriteBench({ label, dir, fileCount, payload, batchSize = 1 }) {
  fs.mkdirSync(dir, { recursive: true });
  const timings = [];
  const start = process.hrtime.bigint();
  if (batchSize <= 1) {
    for (let i = 0; i < fileCount; i += 1) {
      const filePath = path.join(dir, `doc-${i}.bin`);
      await fs.promises.writeFile(filePath, payload);
    }
  } else {
    for (let i = 0; i < fileCount; i += batchSize) {
      const tasks = [];
      const limit = Math.min(fileCount, i + batchSize);
      for (let j = i; j < limit; j += 1) {
        const filePath = path.join(dir, `doc-${j}.bin`);
        tasks.push(fs.promises.writeFile(filePath, payload));
      }
      await Promise.all(tasks);
    }
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  timings.push(elapsed);
  const stats = summarizeDurations(timings);
  const totalBytes = fileCount * payload.length;
  const bytesPerSec = elapsed > 0 ? totalBytes / (elapsed / 1000) : 0;
  return {
    label,
    totalMs: elapsed,
    stats,
    filesWritten: fileCount,
    bytesWritten: totalBytes,
    bytesPerSec
  };
}

function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const rate = Number.isFinite(bench.bytesPerSec) ? (bench.bytesPerSec / (1024 * 1024)).toFixed(2) : 'n/a';
  console.error(`- ${label}: ${stats} | MB/sec ${rate}`);
}
