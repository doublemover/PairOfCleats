#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile, writeJsonLinesFileAsync } from '../../../src/shared/json-stream.js';
import { sha1File } from '../../../src/shared/hash.js';
import { createChunkMetaIterator } from '../../../src/index/build/artifacts/writers/chunk-meta.js';

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

const randomText = (rng, length) => {
  const chars = [];
  for (let i = 0; i < length; i += 1) {
    const code = 97 + Math.floor(rng() * 26);
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
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

const args = parseArgs();
const chunkCount = Number(args.chunks) || 40000;
const tokensPerChunk = Number(args.tokens) || 120;
const maxJsonBytes = Number(args.maxJsonBytes) || 1400;
const seed = Number(args.seed) || 707;
const sampleEvery = Number(args.sampleEvery) || 500;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'chunk-meta-stream');
await fs.mkdir(benchRoot, { recursive: true });

const rng = createRng(seed);
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

const formatResult = (result, baseline = null) => {
  const peakMb = result.peakHeap / (1024 * 1024);
  const parts = [
    `chunks=${chunkCount}`,
    `maxJsonBytes=${maxJsonBytes}`,
    `ms=${result.durationMs.toFixed(1)}`,
    `heapPeak=${peakMb.toFixed(1)}MB`,
    `hash=${result.hash.slice(0, 8)}`,
    formatTrim(result.trimStats)
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
