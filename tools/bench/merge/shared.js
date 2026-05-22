import fs from 'node:fs/promises';
import path from 'node:path';
import { formatBytes } from '../../../src/shared/disk-space.js';
import { writeJsonlRunFile } from '../../../src/shared/merge.js';

const parsePositiveInteger = (value, minimum) => Math.max(minimum, Math.floor(Number(value)));

export const parseMergeBenchArgs = (argv, defaults) => {
  const args = { ...defaults };
  const acceptsMaxOpenRuns = Object.hasOwn(defaults, 'maxOpenRuns');
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--runs' && next) {
      args.runs = parsePositiveInteger(next, 1);
      i += 1;
    } else if (key === '--run-size' && next) {
      args.runSize = parsePositiveInteger(next, 1);
      i += 1;
    } else if (key === '--seed' && next) {
      args.seed = parsePositiveInteger(next, 1);
      i += 1;
    } else if (acceptsMaxOpenRuns && key === '--max-open-runs' && next) {
      args.maxOpenRuns = parsePositiveInteger(next, 2);
      i += 1;
    }
  }
  return args;
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

export const compareRows = (a, b) => {
  const left = String(a?.token || '');
  const right = String(b?.token || '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const prepareMergeBenchWorkspace = async (name) => {
  const benchRoot = path.join(process.cwd(), '.benchCache', name);
  await fs.rm(benchRoot, { recursive: true, force: true });
  await fs.mkdir(benchRoot, { recursive: true });
  const runsDir = path.join(benchRoot, 'runs');
  await fs.mkdir(runsDir, { recursive: true });
  return { benchRoot, runsDir };
};

export const buildMergeBenchRuns = async ({ dir, runCount, runSize, seed }) => {
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

export const sumFileBytes = async (paths) => {
  let total = 0;
  for (const entry of paths) {
    const stat = await fs.stat(entry);
    total += stat.size;
  }
  return total;
};

const formatRate = (value) => (Number.isFinite(value) ? value.toFixed(1) : '0');

export const logBenchComparison = ({ runs, runSize, spillBytes, baseline, current }) => {
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
