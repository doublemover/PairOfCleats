#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io.js';
import { readJsonlRowAt } from '../../../src/shared/artifact-io/offsets.js';

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
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'jsonl-offset-index');
await fs.mkdir(benchRoot, { recursive: true });

const jsonlPath = path.join(benchRoot, 'rows.jsonl');
const offsetsPath = `${jsonlPath}.offsets.bin`;

const buildRows = () => (
  Array.from({ length: rows }, (_, index) => ({
    id: index,
    text: `row-${index.toString(36)}`
  }))
);

const ensureDataset = async () => {
  await fs.rm(jsonlPath, { force: true });
  await fs.rm(offsetsPath, { force: true });
  const items = buildRows();
  await writeJsonLinesFile(jsonlPath, items, { atomic: true, offsets: { path: offsetsPath, atomic: true } });
};

const pickLookupIndexes = () => {
  const indexes = new Array(lookups);
  for (let i = 0; i < lookups; i += 1) {
    indexes[i] = Math.floor(Math.random() * rows);
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
  const parts = [
    `total=${result.totalMs.toFixed(1)}ms`,
    `p50=${p50.toFixed(2)}ms`,
    `p95=${p95.toFixed(2)}ms`
  ];
  if (baseline) {
    const delta = result.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (delta / baseline.totalMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] ${result.label} ${parts.join(' ')}`);
};

await ensureDataset();
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
