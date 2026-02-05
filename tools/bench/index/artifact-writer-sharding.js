#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonArrayFile, writeJsonLinesSharded } from '../../../src/shared/json-stream.js';

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

const args = parseArgs();
const rows = Number(args.rows) || 200000;
const payloadBytes = Number(args.payloadBytes) || 128;
const maxBytes = Number(args.maxBytes) || 4 * 1024 * 1024;
const compression = typeof args.compression === 'string'
  ? args.compression.toLowerCase()
  : 'zstd';
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'artifact-writer-sharding');
await fs.mkdir(benchRoot, { recursive: true });

const buildRows = () => {
  const payload = 'x'.repeat(Math.max(1, payloadBytes));
  return Array.from({ length: rows }, (_, index) => ({ id: index, payload }));
};

const runBaseline = async (items) => {
  const outPath = path.join(benchRoot, 'baseline.json');
  await fs.rm(outPath, { force: true });
  const start = performance.now();
  await writeJsonArrayFile(outPath, items, { atomic: true });
  const durationMs = performance.now() - start;
  const bytes = (await fs.stat(outPath)).size;
  return { label: 'baseline', durationMs, bytes };
};

const runCurrent = async (items) => {
  const partsDirName = 'current-parts';
  const partsDir = path.join(benchRoot, partsDirName);
  await fs.rm(partsDir, { recursive: true, force: true });
  const start = performance.now();
  const result = await writeJsonLinesSharded({
    dir: benchRoot,
    partsDirName,
    partPrefix: 'rows-',
    items,
    maxBytes,
    compression: compression === 'none' ? null : compression,
    atomic: true
  });
  const durationMs = performance.now() - start;
  return {
    label: 'current',
    durationMs,
    bytes: result.totalBytes,
    parts: result.parts.length
  };
};

const formatThroughput = (durationMs) => (
  durationMs > 0 ? (rows / (durationMs / 1000)) : 0
);

const printResult = (result) => {
  const throughput = formatThroughput(result.durationMs);
  const extras = result.parts != null ? ` parts=${result.parts}` : '';
  console.log(
    `[bench] ${result.label} rows=${rows} ms=${result.durationMs.toFixed(1)} ` +
    `throughput=${throughput.toFixed(1)}/s bytes=${result.bytes}${extras}`
  );
  return throughput;
};

const printDelta = (baseline, current, baselineThroughput, currentThroughput) => {
  const deltaMs = current.durationMs - baseline.durationMs;
  const deltaPct = baseline.durationMs > 0 ? (deltaMs / baseline.durationMs) * 100 : 0;
  const deltaThroughput = currentThroughput - baselineThroughput;
  const deltaBytes = current.bytes - baseline.bytes;
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `throughput=${currentThroughput.toFixed(1)}/s Δ=${deltaThroughput.toFixed(1)}/s ` +
    `bytes=${current.bytes} Δ=${deltaBytes}`
  );
};

const items = buildRows();
let baseline = null;
let current = null;
let baselineThroughput = 0;
let currentThroughput = 0;

if (mode !== 'current') {
  baseline = await runBaseline(items);
  baselineThroughput = printResult(baseline);
}

if (mode !== 'baseline') {
  current = await runCurrent(items);
  currentThroughput = printResult(current);
}

if (baseline && current) {
  printDelta(baseline, current, baselineThroughput, currentThroughput);
}
