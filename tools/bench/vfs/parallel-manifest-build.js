#!/usr/bin/env node
// Usage: node tools/bench/vfs/parallel-manifest-build.js --segments 2000 --segment-bytes 128 --concurrency 1,2,4,8 --samples 3 --json
import { createCli } from '../../../src/shared/cli.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';
import { buildVfsManifestRowsForFile } from '../../../src/index/tooling/vfs.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'parallel-manifest-build',
  argv: ['node', 'parallel-manifest-build', ...rawArgs],
  options: {
    segments: { type: 'number', default: 2000, describe: 'Segment count' },
    segmentBytes: { type: 'number', default: 128, describe: 'Bytes per segment' },
    concurrency: { type: 'string', default: '1,2,4,8', describe: 'Concurrency values (comma-separated)' },
    samples: { type: 'number', default: 3, describe: 'Repeat count for timing stats' },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const segmentCount = clampInt(argv.segments, 1, 2000);
const segmentBytes = clampInt(argv.segmentBytes, 8, 128);
const samples = clampInt(argv.samples, 1, 3);
const concurrencyList = parseList(argv.concurrency);

const fileText = 'x'.repeat(segmentCount * segmentBytes);
const chunks = buildChunks({ segmentCount, segmentBytes, fileTextLength: fileText.length });

const scenarios = [];
for (const concurrency of concurrencyList) {
  const bench = await runBench({
    samples,
    concurrency,
    fileText,
    chunks
  });
  scenarios.push({
    concurrency,
    segments: segmentCount,
    segmentBytes,
    rows: bench.rows,
    stats: bench.stats,
    totalMs: bench.totalMs,
    rowsPerSec: bench.rowsPerSec
  });
}

const results = {
  generatedAt: new Date().toISOString(),
  segments: segmentCount,
  segmentBytes,
  samples,
  scenarios
};

if (argv.out) {
  writeJsonWithDir(argv.out, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const scenario of scenarios) {
    const stats = formatStats(scenario.stats);
    const rate = Number.isFinite(scenario.rowsPerSec) ? scenario.rowsPerSec.toFixed(1) : 'n/a';
    console.error(`[parallel-manifest] concurrency=${scenario.concurrency} segments=${segmentCount}`);
    console.error(`- ${stats} | rows/sec ${rate}`);
  }
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function parseList(value) {
  if (!value) return [1, 2, 4, 8];
  return String(value)
    .split(',')
    .map((entry) => clampInt(entry.trim(), 1, 1))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
}

function buildChunks({ segmentCount: count, segmentBytes: bytes, fileTextLength }) {
  const chunks = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const start = i * bytes;
    const end = Math.min(start + bytes, fileTextLength);
    chunks[i] = {
      file: 'src/file.ts',
      lang: 'typescript',
      ext: '.ts',
      containerLanguageId: 'typescript',
      segment: {
        segmentUid: `segu:v1:${i}`,
        segmentId: `seg-${i}`,
        start,
        end,
        languageId: 'typescript',
        ext: '.ts'
      },
      start,
      end,
      chunkUid: `chunk:${i}`
    };
  }
  return chunks;
}

async function runBench({ samples: count, concurrency, fileText, chunks }) {
  const timings = [];
  let totalMs = 0;
  let rows = 0;
  for (let i = 0; i < count; i += 1) {
    const start = process.hrtime.bigint();
    const out = await buildVfsManifestRowsForFile({
      chunks,
      fileText,
      containerPath: 'src/file.ts',
      containerExt: '.ts',
      containerLanguageId: 'typescript',
      concurrency
    });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
    rows = out.length;
  }
  const stats = summarizeDurations(timings);
  const rowsPerSec = totalMs > 0 ? rows / (totalMs / 1000) : 0;
  return { totalMs, rows, rowsPerSec, stats };
}
