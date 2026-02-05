#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';
import { readJsonlRowAt } from '../../../src/shared/artifact-io/offsets.js';
import { readJsonFile } from '../../../src/shared/artifact-io/json.js';
import { readShardFiles } from '../../../src/shared/artifact-io/fs.js';
import { toPosix } from '../../../src/shared/files.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const percentile = (values, pct) => {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return sorted[idx];
};

const args = parseArgs();
const rows = Number(args.rows) || 100000;
const lookups = Number(args.lookups) || 200;
const indexDir = args.index ? path.resolve(String(args.index)) : null;
const artifact = args.artifact ? String(args.artifact) : 'chunk_meta';
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'jsonl-offset-index');
await fs.mkdir(benchRoot, { recursive: true });

let jsonlPath = path.join(benchRoot, 'rows.jsonl');
let offsetsPath = `${jsonlPath}.offsets.bin`;
let resolvedRows = rows;

const buildRows = () => (
  Array.from({ length: rows }, (_, index) => ({
    id: index,
    text: `row-${index.toString(36)}`
  }))
);

const resolveIndexPaths = () => {
  if (!indexDir) return null;
  const metaPath = path.join(indexDir, `${artifact}.meta.json`);
  let parts = [];
  let offsets = [];
  let totalRows = null;
  if (fsSync.existsSync(metaPath)) {
    const metaRaw = readJsonFile(metaPath);
    const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    totalRows = Number.isFinite(meta?.totalRecords) ? meta.totalRecords : (Number.isFinite(meta?.totalRows) ? meta.totalRows : null);
    if (Array.isArray(meta?.parts) && meta.parts.length) {
      parts = meta.parts
        .map((part) => (typeof part === 'string' ? part : part?.path))
        .filter(Boolean)
        .map((part) => path.join(indexDir, part));
    }
    if (Array.isArray(meta?.offsets) && meta.offsets.length) {
      offsets = meta.offsets
        .map((entry) => (typeof entry === 'string' ? entry : entry?.path))
        .filter(Boolean)
        .map((entry) => path.join(indexDir, entry));
    }
  }
  if (!parts.length) {
    const partsDir = path.join(indexDir, `${artifact}.parts`);
    if (fsSync.existsSync(partsDir)) {
      parts = readShardFiles(partsDir, `${artifact}.part-`);
    }
  }
  if (!parts.length) {
    const directJsonl = path.join(indexDir, `${artifact}.jsonl`);
    if (fsSync.existsSync(directJsonl)) {
      parts = [directJsonl];
    }
  }
  if (!parts.length) return null;
  const resolvedJsonl = parts[0];
  let resolvedOffsets = offsets[0] || null;
  if (!resolvedOffsets) {
    const candidate = `${resolvedJsonl}.offsets.bin`;
    if (fsSync.existsSync(candidate)) {
      resolvedOffsets = candidate;
    }
  }
  return {
    jsonlPath: resolvedJsonl,
    offsetsPath: resolvedOffsets,
    rows: totalRows
  };
};

const ensureDataset = async () => {
  const resolved = resolveIndexPaths();
  if (resolved) {
    jsonlPath = resolved.jsonlPath;
    offsetsPath = resolved.offsetsPath || offsetsPath;
    resolvedRows = Number.isFinite(resolved.rows) ? resolved.rows : resolvedRows;
    return;
  }
  await fs.rm(jsonlPath, { force: true });
  await fs.rm(offsetsPath, { force: true });
  const items = buildRows();
  await writeJsonLinesFile(jsonlPath, items, { atomic: true, offsets: { path: offsetsPath, atomic: true } });
};

const pickLookupIndexes = () => {
  const indexes = new Array(lookups);
  for (let i = 0; i < lookups; i += 1) {
    indexes[i] = Math.floor(Math.random() * resolvedRows);
  }
  return indexes;
};

const runBaseline = async (indexes) => {
  const timings = [];
  const startTotal = performance.now();
  for (const index of indexes) {
    const start = performance.now();
    const list = await readJsonLinesArray(jsonlPath);
    void list[index];
    timings.push(performance.now() - start);
  }
  const totalMs = performance.now() - startTotal;
  return { label: 'baseline', totalMs, timings };
};

const runOffsets = async (indexes) => {
  const timings = [];
  const startTotal = performance.now();
  for (const index of indexes) {
    const start = performance.now();
    await readJsonlRowAt(jsonlPath, offsetsPath, index);
    timings.push(performance.now() - start);
  }
  const totalMs = performance.now() - startTotal;
  return { label: 'offsets', totalMs, timings };
};

const printResult = (result, baseline = null) => {
  const p50 = percentile(result.timings, 0.5);
  const p95 = percentile(result.timings, 0.95);
  const throughput = result.timings.length
    ? (result.timings.length / (result.totalMs / 1000))
    : 0;
  const parts = [
    `total=${result.totalMs.toFixed(1)}ms`,
    `p50=${p50.toFixed(2)}ms`,
    `p95=${p95.toFixed(2)}ms`,
    `throughput=${throughput.toFixed(1)}/s`,
    `amount=${result.timings.length}`
  ];
  console.log(`[bench] ${result.label} ${parts.join(' ')}`);
  if (baseline) {
    const deltaMs = result.totalMs - baseline.totalMs;
    const deltaPct = baseline.totalMs > 0 ? (deltaMs / baseline.totalMs) * 100 : 0;
    const baselineThroughput = baseline.timings.length
      ? (baseline.timings.length / (baseline.totalMs / 1000))
      : 0;
    const deltaThroughput = throughput - baselineThroughput;
    const throughputPct = baselineThroughput ? (deltaThroughput / baselineThroughput) * 100 : 0;
    console.log(
      `[bench] delta duration=${deltaMs.toFixed(1)}ms (${deltaPct.toFixed(1)}%) `
      + `throughput=${deltaThroughput.toFixed(1)}/s (${throughputPct.toFixed(1)}%) `
      + `amount=${result.timings.length}`
    );
  }
};

await ensureDataset();
if (mode !== 'baseline' && !offsetsPath) {
  throw new Error(`Offsets file missing for ${toPosix(jsonlPath)} (pass --mode baseline or provide offsets).`);
}
const indexes = pickLookupIndexes();
let baseline = null;
let current = null;

if (mode !== 'current') {
  baseline = await runBaseline(indexes);
  printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runOffsets(indexes);
  printResult(current, baseline);
}
