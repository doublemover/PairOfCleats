import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { mergeRunsWithPlanner, mergeSortedRunsToFile, writeJsonlRunFile } from '../../../src/shared/merge.js';

const parseArgs = (argv) => {
  const args = { runs: 64, runSize: 2000, seed: 1337, maxOpenRuns: 8 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--runs' && next) {
      args.runs = Math.max(1, Math.floor(Number(next)));
      i += 1;
    } else if (key === '--run-size' && next) {
      args.runSize = Math.max(1, Math.floor(Number(next)));
      i += 1;
    } else if (key === '--seed' && next) {
      args.seed = Math.max(1, Math.floor(Number(next)));
      i += 1;
    } else if (key === '--max-open-runs' && next) {
      args.maxOpenRuns = Math.max(2, Math.floor(Number(next)));
      i += 1;
    }
  }
  return args;
};

const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0B';
  if (value < 1024) return `${Math.round(value)}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)}GB`;
};

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const compareRows = (a, b) => {
  const left = String(a?.token || '');
  const right = String(b?.token || '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const buildRuns = async ({ dir, runCount, runSize, seed }) => {
  const rng = mulberry32(seed);
  const runPaths = [];
  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const rows = [];
    for (let i = 0; i < runSize; i += 1) {
      const jitter = Math.floor(rng() * runCount);
      const tokenId = i * runCount + jitter;
      rows.push({ token: String(tokenId).padStart(10, '0'), postings: [i] });
    }
    rows.sort(compareRows);
    const runPath = path.join(dir, `run-${String(runIndex).padStart(3, '0')}.jsonl`);
    await writeJsonlRunFile(runPath, rows, { atomic: true });
    runPaths.push(runPath);
  }
  return runPaths;
};

const sumFileBytes = async (paths) => {
  let total = 0;
  for (const entry of paths) {
    const stat = await fs.stat(entry);
    total += stat.size;
  }
  return total;
};

const runBaseline = async ({ runs, outputPath }) => {
  const heapStart = process.memoryUsage().heapUsed;
  const stats = await mergeSortedRunsToFile({
    runs,
    outputPath,
    compare: compareRows
  });
  const heapDelta = process.memoryUsage().heapUsed - heapStart;
  return {
    rows: stats.rows,
    bytes: stats.bytes,
    elapsedMs: stats.elapsedMs,
    heapDelta
  };
};

const runPlanner = async ({ runs, outputPath, maxOpenRuns, tempDir }) => {
  const heapStart = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = await mergeRunsWithPlanner({
    runs,
    outputPath,
    compare: compareRows,
    tempDir,
    runPrefix: 'spill',
    maxOpenRuns
  });
  const elapsedMs = performance.now() - startedAt;
  const heapDelta = process.memoryUsage().heapUsed - heapStart;
  return {
    rows: result.stats?.rows || 0,
    bytes: result.stats?.bytes || 0,
    elapsedMs,
    heapDelta,
    cleanup: result.cleanup
  };
};

const formatRate = (value) => (Number.isFinite(value) ? value.toFixed(1) : '0');

const main = async () => {
  const { runs, runSize, seed, maxOpenRuns } = parseArgs(process.argv.slice(2));
  const benchRoot = path.join(process.cwd(), '.benchCache', 'spill-merge-compare');
  await fs.rm(benchRoot, { recursive: true, force: true });
  await fs.mkdir(benchRoot, { recursive: true });
  const runsDir = path.join(benchRoot, 'runs');
  await fs.mkdir(runsDir, { recursive: true });
  const runPaths = await buildRuns({ dir: runsDir, runCount: runs, runSize, seed });
  const spillBytes = await sumFileBytes(runPaths);

  const baselinePath = path.join(benchRoot, 'baseline.jsonl');
  const currentPath = path.join(benchRoot, 'current.jsonl');
  const baseline = await runBaseline({ runs: runPaths, outputPath: baselinePath });
  const current = await runPlanner({
    runs: runPaths,
    outputPath: currentPath,
    maxOpenRuns,
    tempDir: path.join(benchRoot, 'planner')
  });
  if (current.cleanup) await current.cleanup();
  const baselineRowsPerSec = baseline.rows / (baseline.elapsedMs / 1000);
  const currentRowsPerSec = current.rows / (current.elapsedMs / 1000);
  const baselineBytesPerSec = baseline.bytes / (baseline.elapsedMs / 1000);
  const currentBytesPerSec = current.bytes / (current.elapsedMs / 1000);
  const deltaMs = current.elapsedMs - baseline.elapsedMs;
  const deltaPct = baseline.elapsedMs ? (deltaMs / baseline.elapsedMs) * 100 : 0;

  console.log(
    `[bench] baseline runs=${runs} runSize=${runSize} rows=${baseline.rows} ` +
    `bytes=${formatBytes(baseline.bytes)} spillBytes=${formatBytes(spillBytes)} ` +
    `ms=${baseline.elapsedMs.toFixed(1)} rowsPerSec=${formatRate(baselineRowsPerSec)} ` +
    `bytesPerSec=${formatBytes(baselineBytesPerSec)}/s heapDelta=${formatBytes(baseline.heapDelta)}`
  );
  console.log(
    `[bench] current runs=${runs} runSize=${runSize} rows=${current.rows} ` +
    `bytes=${formatBytes(current.bytes)} spillBytes=${formatBytes(spillBytes)} ` +
    `ms=${current.elapsedMs.toFixed(1)} rowsPerSec=${formatRate(currentRowsPerSec)} ` +
    `bytesPerSec=${formatBytes(currentBytesPerSec)}/s heapDelta=${formatBytes(current.heapDelta)}`
  );
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `rowsPerSec=${formatRate(currentRowsPerSec - baselineRowsPerSec)} ` +
    `bytesPerSec=${formatBytes(currentBytesPerSec - baselineBytesPerSec)}/s ` +
    `duration=${current.elapsedMs.toFixed(1)}ms`
  );
};

await main();
