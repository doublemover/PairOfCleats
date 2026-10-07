#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile, writeJsonLinesFileAsync } from '../../../src/shared/json-stream/jsonl-write.js';
import { sha1File } from '../../../src/shared/hash.js';
import { createChunkMetaIterator } from '../../../src/index/build/artifacts/writers/chunk-meta.js';
import {
  createSeededRng,
  parseSimpleBenchArgs,
  resolveCompareMode
} from '../shared.js';
import {
  createPeakTracker,
  formatBenchResult,
  runCompareBench
} from './streaming-bench-reporting.js';

const randomText = (rng, length) => {
  const chars = [];
  for (let i = 0; i < length; i += 1) {
    const code = 97 + Math.floor(rng() * 26);
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
};

const args = parseSimpleBenchArgs();
const chunkCount = Number(args.chunks) || 40000;
const tokensPerChunk = Number(args.tokens) || 120;
const maxJsonBytes = Number(args.maxJsonBytes) || 1400;
const seed = Number(args.seed) || 707;
const sampleEvery = Number(args.sampleEvery) || 500;
const mode = resolveCompareMode(args.mode);

const benchRoot = path.join(process.cwd(), '.benchCache', 'chunk-meta-stream');
await fs.mkdir(benchRoot, { recursive: true });

const rng = createSeededRng(seed);
const files = Array.from({ length: Math.max(1, Math.floor(chunkCount / 20)) }, (_, i) => `src/file-${i}.ts`);
const fileIdByPath = new Map(files.map((file, index) => [file, index]));

const chunks = new Array(chunkCount);
for (let i = 0; i < chunkCount; i += 1) {
  const file = files[i % files.length];
  const tokens = Array.from({ length: tokensPerChunk }, () => `tok-${randomText(rng, 8)}`);
  const ngrams = Array.from({ length: Math.floor(tokensPerChunk / 4) }, () => `ng-${randomText(rng, 6)}`);
  chunks[i] = {
    id: i,
    chunkId: i,
    file,
    ext: '.ts',
    lang: 'ts',
    fileHash: `hash-${i % 997}`,
    fileHashAlgo: 'sha1',
    fileSize: 1000 + i,
    chunkUid: `chunk-${i}`,
    virtualPath: file,
    start: i * 3,
    end: i * 3 + 2,
    startLine: i + 1,
    endLine: i + 1,
    kind: 'code',
    name: `fn-${i}`,
    weight: 1,
    headline: randomText(rng, 80),
    preContext: randomText(rng, 80),
    postContext: randomText(rng, 80),
    segment: {
      segmentUid: `seg-${i}`,
      virtualPath: file,
      header: randomText(rng, 50)
    },
    docmeta: {
      language: 'ts',
      tooling: { sources: [{ name: 'bench', collectedAt: new Date().toISOString() }] }
    },
    metaV2: {
      chunkUid: `chunk-${i}`,
      virtualPath: file,
      symbol: {
        symbolId: `sym-${i}`,
        scopedId: `scoped-${i}`,
        symbolKey: `key-${i}`,
        qualifiedName: `ns.fn-${i}`,
        kindGroup: 'value'
      },
      payload: randomText(rng, 200)
    },
    tokens,
    ngrams,
    chunk_authors: [`author-${i % 5}`],
    chunkAuthors: [`author-${i % 5}`]
  };
}

const runBaseline = async () => {
  const outPath = path.join(benchRoot, 'chunk_meta-baseline.jsonl');
  await fs.rm(outPath, { force: true });
  const tracker = createPeakTracker();
  const iterator = createChunkMetaIterator({
    chunks,
    fileIdByPath,
    resolvedTokenMode: 'full',
    tokenSampleSize: 40,
    maxJsonBytes
  });
  iterator.resetStats?.();
  const rows = [];
  const start = performance.now();
  let index = 0;
  for (const entry of iterator(0, chunks.length, true)) {
    rows.push(entry);
    if (index % sampleEvery === 0) tracker.sample();
    index += 1;
  }
  tracker.sample();
  await writeJsonLinesFile(outPath, rows, { atomic: true });
  const durationMs = performance.now() - start;
  const hash = await sha1File(outPath);
  return {
    label: 'baseline',
    durationMs,
    peakHeap: tracker.getPeak(),
    hash,
    trimStats: iterator.stats,
    outPath
  };
};

const runStreaming = async () => {
  const outPath = path.join(benchRoot, 'chunk_meta-stream.jsonl');
  await fs.rm(outPath, { force: true });
  const tracker = createPeakTracker();
  const iterator = createChunkMetaIterator({
    chunks,
    fileIdByPath,
    resolvedTokenMode: 'full',
    tokenSampleSize: 40,
    maxJsonBytes
  });
  iterator.resetStats?.();
  const stream = (async function* iteratorStream() {
    let index = 0;
    for (const entry of iterator(0, chunks.length, true)) {
      if (index % sampleEvery === 0) tracker.sample();
      index += 1;
      yield entry;
    }
    tracker.sample();
  })();
  const start = performance.now();
  await writeJsonLinesFileAsync(outPath, stream, { atomic: true });
  const durationMs = performance.now() - start;
  const hash = await sha1File(outPath);
  return {
    label: 'stream',
    durationMs,
    peakHeap: tracker.getPeak(),
    hash,
    trimStats: iterator.stats,
    outPath
  };
};

const formatTrim = (stats) => {
  if (!stats) return 'trimmedEntries=0 trimmedMetaV2=0';
  const fields = stats.trimmedFields && Object.keys(stats.trimmedFields).length
    ? JSON.stringify(stats.trimmedFields)
    : '{}';
  return `trimmedEntries=${stats.trimmedEntries || 0} trimmedMetaV2=${stats.trimmedMetaV2 || 0} trimmedFields=${fields}`;
};

const formatResult = (result, baseline = null) => formatBenchResult({
  result,
  fields: [
    `chunks=${chunkCount}`,
    `maxJsonBytes=${maxJsonBytes}`
  ],
  extraFields: [formatTrim(result.trimStats)],
  baseline
});

await runCompareBench({
  mode,
  runBaseline,
  runCurrent: runStreaming,
  formatResult
});
