#!/usr/bin/env node
// Usage: node tools/bench/vfs/vfsidx-lookup.js --rows 100000 --lookups 20000 --json
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../../src/shared/cli.js';
import { formatStats, summarizeDurations, writeJsonWithDir } from '../micro/utils.js';

const rawArgs = process.argv.slice(2);
const cli = createCli({
  scriptName: 'vfsidx-lookup',
  argv: ['node', 'vfsidx-lookup', ...rawArgs],
  options: {
    rows: { type: 'number', default: 100000, describe: 'Manifest row count' },
    lookups: { type: 'number', default: 20000, describe: 'Lookup count' },
    samples: { type: 'number', default: 10, describe: 'Sample buckets for timing stats' },
    seed: { type: 'number', default: 1 },
    input: { type: 'string', describe: 'JSON file with rows array' },
    json: { type: 'boolean', default: false },
    out: { type: 'string', describe: 'Write JSON results to a file' }
  }
});
const argv = cli.parse();

const rowsTarget = clampInt(argv.rows, 1, 100000);
const lookups = clampInt(argv.lookups, 1, 20000);
const samples = clampInt(argv.samples, 1, 10);
const seed = Number.isFinite(argv.seed) ? Number(argv.seed) : 1;
const inputPath = argv.input ? path.resolve(String(argv.input)) : null;

const { rows, source } = loadRows({ rowsTarget, seed, inputPath });
const index = new Map(rows.map((row) => [row.virtualPath, row.offset]));
const lookupKeys = buildLookupKeys(lookups, rows, seed + 7);

const indexedBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => index.get(lookupKeys[i])
});

const scanBench = runSampled({
  iterations: lookups,
  samples,
  fn: (i) => scanRows(rows, lookupKeys[i])
});

const results = {
  generatedAt: new Date().toISOString(),
  source,
  rows: rows.length,
  lookups,
  samples,
  bench: {
    indexedLookup: indexedBench,
    fullScan: scanBench
  }
};

if (argv.out) {
  const outPath = path.resolve(String(argv.out));
  writeJsonWithDir(outPath, results);
}

if (argv.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.error(`[vfsidx] rows=${rows.length} lookups=${lookups}`);
  printBench('indexed', indexedBench);
  printBench('full-scan', scanBench);
}

function clampInt(value, min, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function createRng(seedValue) {
  let state = (seedValue >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function loadRows({ rowsTarget, seed: seedValue, inputPath: input }) {
  let rows = null;
  let source = { type: 'generated' };
  if (input) {
    if (!fs.existsSync(input)) {
      throw new Error(`Input not found: ${input}`);
    }
    const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rows)
        ? payload.rows
        : [];
    rows = list
      .map((row) => {
        if (typeof row === 'string') return { virtualPath: row, offset: 0 };
        if (row && typeof row.virtualPath === 'string') {
          return { virtualPath: row.virtualPath, offset: Number(row.offset) || 0 };
        }
        return null;
      })
      .filter(Boolean);
    if (!rows.length) {
      throw new Error('Input file did not include rows.');
    }
    source = { type: 'input', inputPath: input };
  }
  if (!rows) {
    const rng = createRng(seedValue);
    const exts = ['ts', 'js', 'py', 'go', 'rs'];
    rows = new Array(rowsTarget);
    for (let i = 0; i < rowsTarget; i += 1) {
      const ext = exts[i % exts.length];
      const dir = Math.floor(rng() * 800);
      const pathSuffix = `dir-${dir}/file-${i}.${ext}`;
      rows[i] = { virtualPath: `.poc-vfs/${pathSuffix}`, offset: i * 128 };
    }
  }
  if (Number.isFinite(rowsTarget) && rows.length > rowsTarget) {
    rows = rows.slice(0, rowsTarget);
  }
  return { rows, source };
}

function buildLookupKeys(count, rows, seedValue) {
  const rng = createRng(seedValue);
  const keys = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const pick = rows[Math.floor(rng() * rows.length)];
    keys[i] = pick.virtualPath;
  }
  return keys;
}

function scanRows(rows, key) {
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].virtualPath === key) return rows[i].offset;
  }
  return null;
}

function runSampled({ iterations, samples, fn }) {
  const timings = [];
  const perSample = Math.max(1, Math.floor(iterations / samples));
  const remainder = iterations - perSample * samples;
  let totalMs = 0;
  let index = 0;
  for (let i = 0; i < samples; i += 1) {
    const loops = perSample + (i < remainder ? 1 : 0);
    const start = process.hrtime.bigint();
    for (let j = 0; j < loops; j += 1) {
      fn(index);
      index += 1;
    }
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsed);
    totalMs += elapsed;
  }
  const stats = summarizeDurations(timings);
  const opsPerSec = totalMs > 0 ? iterations / (totalMs / 1000) : 0;
  return { totalMs, opsPerSec, stats };
}

function printBench(label, bench) {
  const stats = bench.stats ? formatStats(bench.stats) : 'n/a';
  const ops = Number.isFinite(bench.opsPerSec) ? bench.opsPerSec.toFixed(1) : 'n/a';
  console.error(`- ${label}: ${stats} | ops/sec ${ops}`);
}
