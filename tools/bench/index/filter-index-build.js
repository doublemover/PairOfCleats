#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import {
  buildFilterIndex,
  releaseFilterIndexMemory
} from '../../../src/retrieval/filter-index.js';
import {
  buildBitmapIndex,
  createBitmapFromIds,
  isRoaringAvailable,
  shouldUseBitmap
} from '../../../src/retrieval/bitmap.js';

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

if (!isRoaringAvailable()) {
  console.log('[bench] roaring-wasm not available; skipping filter-index build bitmap bench');
  process.exit(0);
}

const args = parseArgs();
const fileCount = Math.max(1, Number(args.files) || 2000);
const chunksPerFile = Math.max(1, Number(args.chunksPerFile) || 32);
const bitmapMinSize = Math.max(1, Number(args.minSize) || 256);
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const buildChunks = () => {
  const chunks = [];
  let id = 0;
  for (let f = 0; f < fileCount; f += 1) {
    const file = `src/file-${String(f).padStart(5, '0')}.js`;
    const author = f % 2 ? 'Alice' : 'Bob';
    for (let c = 0; c < chunksPerFile; c += 1) {
      chunks.push({
        id,
        file,
        ext: '.js',
        kind: 'FunctionDeclaration',
        last_author: author,
        chunk_authors: [author],
        docmeta: { visibility: 'public' },
        metaV2: { lang: 'javascript', effective: { languageId: 'javascript' } }
      });
      id += 1;
    }
  }
  return chunks;
};

const buildLegacyBitmapIndex = (index, { minSize } = {}) => {
  const buildMap = (source) => {
    const out = new Map();
    if (!source || typeof source.entries !== 'function') return out;
    for (const [key, set] of source.entries()) {
      if (!set || !shouldUseBitmap(set.size, minSize)) continue;
      const bitmap = createBitmapFromIds(set, { force: true, minSize });
      if (bitmap) out.set(key, bitmap);
    }
    return out;
  };
  return {
    enabled: true,
    minSize,
    byExt: buildMap(index.byExt),
    byLang: buildMap(index.byLang),
    byKind: buildMap(index.byKind),
    byAuthor: buildMap(index.byAuthor),
    byChunkAuthor: buildMap(index.byChunkAuthor),
    byVisibility: buildMap(index.byVisibility)
  };
};

const countFileBitmaps = (bitmapIndex) => {
  const list = bitmapIndex?.fileChunksById;
  if (!Array.isArray(list)) return 0;
  let count = 0;
  for (const entry of list) {
    if (entry) count += 1;
  }
  return count;
};

const chunks = buildChunks();
const index = buildFilterIndex(chunks, {
  fileChargramN: 3,
  includeBitmaps: false
});

const runBaseline = () => {
  const start = performance.now();
  const bitmap = buildLegacyBitmapIndex(index, { minSize: bitmapMinSize });
  const durationMs = performance.now() - start;
  return { durationMs, fileBitmaps: countFileBitmaps(bitmap) };
};

const runCurrent = () => {
  const start = performance.now();
  const bitmap = buildBitmapIndex(index, { minSize: bitmapMinSize });
  const durationMs = performance.now() - start;
  return { durationMs, fileBitmaps: countFileBitmaps(bitmap) };
};

const printBaseline = (result) => {
  console.log(
    `[bench] baseline ms=${result.durationMs.toFixed(1)} fileBitmaps=${result.fileBitmaps}`
  );
};

const printCurrent = (result, baseline = null) => {
  const parts = [
    `ms=${result.durationMs.toFixed(1)}`,
    `fileBitmaps=${result.fileBitmaps}`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
  }
  console.log(`[bench] current ${parts.join(' ')}`);
};

let baseline = null;
if (mode !== 'current') {
  baseline = runBaseline();
  printBaseline(baseline);
}
if (mode !== 'baseline') {
  const current = runCurrent();
  printCurrent(current, baseline);
}

releaseFilterIndexMemory(index);

