#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile, writeJsonLinesFileAsync } from '../../../src/shared/json-stream/jsonl-write.js';
import { sha1File } from '../../../src/shared/hash.js';
import {
  createSeededRng,
  parseSimpleBenchArgs,
  pickRandom,
  resolveCompareMode
} from '../shared.js';
import {
  createPeakTracker,
  formatBenchResult,
  runCompareBench
} from './streaming-bench-reporting.js';

const args = parseSimpleBenchArgs();
const rowCount = Number(args.rows) || 50000;
const seed = Number(args.seed) || 4242;
const sampleEvery = Number(args.sampleEvery) || 500;
const mode = resolveCompareMode(args.mode);

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
    scheme: pickRandom(rng, schemes),
    symbolKey: `key-${symbolBase}`,
    signatureKey: `sig-${symbolBase}`,
    chunkUid: `chunk-${index}`,
    virtualPath: file,
    segmentUid: `seg-${index}`,
    file,
    lang: pickRandom(rng, langs),
    kind: pickRandom(rng, kinds),
    kindGroup: pickRandom(rng, kindGroups),
    name,
    qualifiedName: `ns.${name}`,
    signature: `fn(${index})`
  };
};

const buildRows = (count, seedValue, tracker) => {
  const rng = createSeededRng(seedValue);
  const rows = new Array(count);
  for (let i = 0; i < count; i += 1) {
    rows[i] = createRow(i, rng);
    if (tracker && i % sampleEvery === 0) tracker.sample();
  }
  if (tracker) tracker.sample();
  return rows;
};

const buildRowStream = (count, seedValue, tracker) => {
  const rng = createSeededRng(seedValue);
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

const formatResult = (result, baseline = null) => formatBenchResult({
  result,
  fields: [`rows=${rowCount}`],
  baseline
});

await runCompareBench({
  mode,
  runBaseline,
  runCurrent: runStreaming,
  formatResult
});
