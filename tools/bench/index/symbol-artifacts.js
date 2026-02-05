#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile, writeJsonLinesFileAsync } from '../../../src/shared/json-stream.js';
import { sha1File } from '../../../src/shared/hash.js';

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

const createRng = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const args = parseArgs();
const rowCount = Number(args.rows) || 50000;
const seed = Number(args.seed) || 4242;
const sampleEvery = Number(args.sampleEvery) || 500;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'symbol-artifacts');
await fs.mkdir(benchRoot, { recursive: true });

const langs = ['ts', 'js', 'py', 'go'];
const kinds = ['function', 'class', 'method', 'const'];
const kindGroups = ['value', 'type'];
const schemes = ['ts', 'js'];

const createRow = (index, rng) => {
  const fileId = Math.floor(index / 20);
  const file = `src/file-${fileId}.ts`;
  const symbolBase = `sym-${index}`;
  const name = `Name${index}`;
  return {
    v: 1,
    symbolId: symbolBase,
    scopedId: `scoped-${symbolBase}`,
    scheme: pick(rng, schemes),
    symbolKey: `key-${symbolBase}`,
    signatureKey: `sig-${symbolBase}`,
    chunkUid: `chunk-${index}`,
    virtualPath: file,
    segmentUid: `seg-${index}`,
    file,
    lang: pick(rng, langs),
    kind: pick(rng, kinds),
    kindGroup: pick(rng, kindGroups),
    name,
    qualifiedName: `ns.${name}`,
    signature: `fn(${index})`
  };
};

const createPeakTracker = () => {
  let peak = process.memoryUsage().heapUsed;
  return {
    sample() {
      const used = process.memoryUsage().heapUsed;
      if (used > peak) peak = used;
    },
    getPeak() {
      return peak;
    }
  };
};

const buildRows = (count, seedValue, tracker) => {
  const rng = createRng(seedValue);
  const rows = new Array(count);
  for (let i = 0; i < count; i += 1) {
    rows[i] = createRow(i, rng);
    if (tracker && i % sampleEvery === 0) tracker.sample();
  }
  if (tracker) tracker.sample();
  return rows;
};

const buildRowStream = (count, seedValue, tracker) => {
  const rng = createRng(seedValue);
  return (async function* iterator() {
    for (let i = 0; i < count; i += 1) {
      if (tracker && i % sampleEvery === 0) tracker.sample();
      yield createRow(i, rng);
    }
    if (tracker) tracker.sample();
  })();
};

const runBaseline = async () => {
  const outPath = path.join(benchRoot, 'symbols-baseline.jsonl');
  await fs.rm(outPath, { force: true });
  const tracker = createPeakTracker();
  const start = performance.now();
  const rows = buildRows(rowCount, seed, tracker);
  await writeJsonLinesFile(outPath, rows, { atomic: true });
  const durationMs = performance.now() - start;
  const hash = await sha1File(outPath);
  return {
    label: 'baseline',
    durationMs,
    peakHeap: tracker.getPeak(),
    hash,
    outPath
  };
};

const runStreaming = async () => {
  const outPath = path.join(benchRoot, 'symbols-stream.jsonl');
  await fs.rm(outPath, { force: true });
  const tracker = createPeakTracker();
  const start = performance.now();
  const rows = buildRowStream(rowCount, seed, tracker);
  await writeJsonLinesFileAsync(outPath, rows, { atomic: true });
  const durationMs = performance.now() - start;
  const hash = await sha1File(outPath);
  return {
    label: 'stream',
    durationMs,
    peakHeap: tracker.getPeak(),
    hash,
    outPath
  };
};

const formatResult = (result, baseline = null) => {
  const peakMb = result.peakHeap / (1024 * 1024);
  const parts = [
    `rows=${rowCount}`,
    `ms=${result.durationMs.toFixed(1)}`,
    `heapPeak=${peakMb.toFixed(1)}MB`,
    `hash=${result.hash.slice(0, 8)}`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    const memDelta = result.peakHeap - baseline.peakHeap;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
    parts.push(`heapΔ=${(memDelta / (1024 * 1024)).toFixed(1)}MB`);
  }
  return parts;
};

let baseline = null;
if (mode !== 'current') {
  baseline = await runBaseline();
  console.log(`[bench] baseline ${formatResult(baseline).join(' ')}`);
}
if (mode !== 'baseline') {
  const current = await runStreaming();
  console.log(`[bench] stream ${formatResult(current, baseline).join(' ')}`);
  if (baseline) {
    const match = baseline.hash === current.hash;
    console.log(`[bench] hash-compare match=${match}`);
  }
}
