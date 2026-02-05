#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { readJsonFile, readJsonLinesArray } from '../../../src/shared/artifact-io.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

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
const chunkCount = Number(args.chunks) || 100000;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const tempRoot = path.join(process.cwd(), '.benchCache', 'sqlite-build-from-artifacts');
const indexDir = path.join(tempRoot, 'index-code');
const baselineIndexDir = path.join(tempRoot, 'index-baseline');
const outPathBaseline = path.join(tempRoot, 'index-code-baseline.db');
const outPathCurrent = path.join(tempRoot, 'index-code-current.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });
await fs.mkdir(baselineIndexDir, { recursive: true });

const tokens = ['alpha', 'beta'];
const chunkIterator = function* chunkIterator() {
  for (let i = 0; i < chunkCount; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % 10}.js`,
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: 'code',
      name: `fn${i}`,
      tokens
    };
  }
};

const shardResult = await writeJsonLinesSharded({
  dir: indexDir,
  partsDirName: 'chunk_meta.parts',
  partPrefix: 'chunk_meta.part-',
  items: chunkIterator(),
  maxBytes: 8192,
  atomic: true
});
await writeJsonObjectFile(path.join(indexDir, 'chunk_meta.meta.json'), {
  fields: {
    schemaVersion: '0.0.1',
    artifact: 'chunk_meta',
    format: 'jsonl-sharded',
    generatedAt: new Date().toISOString(),
    compression: 'none',
    totalRecords: shardResult.total,
    totalBytes: shardResult.totalBytes,
    maxPartRecords: shardResult.maxPartRecords,
    maxPartBytes: shardResult.maxPartBytes,
    targetMaxBytes: shardResult.targetMaxBytes,
    parts: shardResult.parts.map((part, index) => ({
      path: part,
      records: shardResult.counts[index] || 0,
      bytes: shardResult.bytes[index] || 0
    }))
  },
  atomic: true
});

const postingsDir = path.join(indexDir, 'token_postings.shards');
await fs.mkdir(postingsDir, { recursive: true });
const postingsPart = path.join(postingsDir, 'token_postings.part-00000.json');
const postingsEntries = Array.from({ length: chunkCount }, (_, i) => [i, 1]);
await writeJsonObjectFile(postingsPart, {
  arrays: {
    vocab: ['alpha'],
    postings: [postingsEntries]
  },
  atomic: true
});
const docLengths = Array.from({ length: chunkCount }, () => tokens.length);
await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
  fields: {
    avgDocLen: tokens.length,
    totalDocs: chunkCount,
    format: 'sharded',
    shardSize: 1,
    vocabCount: 1,
    parts: ['token_postings.shards/token_postings.part-00000.json']
  },
  arrays: { docLengths },
  atomic: true
});

const buildBaselineIndex = async () => {
  const chunkMeta = [];
  for (const part of shardResult.parts) {
    const partPath = path.join(indexDir, part);
    const rows = await readJsonLinesArray(partPath);
    if (rows.length) chunkMeta.push(...rows);
  }
  const tokenMeta = readJsonFile(path.join(indexDir, 'token_postings.meta.json'));
  const tokenPart = readJsonFile(postingsPart);
  const docLengths = tokenMeta?.arrays?.docLengths || tokenMeta?.docLengths || [];
  const avgDocLen = Number.isFinite(tokenMeta?.fields?.avgDocLen)
    ? tokenMeta.fields.avgDocLen
    : (Number.isFinite(tokenMeta?.avgDocLen) ? tokenMeta.avgDocLen : null);
  const totalDocs = Number.isFinite(tokenMeta?.fields?.totalDocs)
    ? tokenMeta.fields.totalDocs
    : (Number.isFinite(tokenMeta?.totalDocs) ? tokenMeta.totalDocs : docLengths.length);
  return {
    chunkMeta,
    tokenPostings: {
      vocab: tokenPart?.arrays?.vocab || tokenPart?.vocab || [],
      postings: tokenPart?.arrays?.postings || tokenPart?.postings || [],
      docLengths,
      avgDocLen,
      totalDocs
    },
    fileMeta: []
  };
};

const runBuild = async ({ label, outPath: targetPath, index, indexDir: targetIndexDir, buildPragmas, optimize }) => {
  const stats = {};
  const start = performance.now();
  const count = await buildDatabaseFromArtifacts({
    Database,
    outPath: targetPath,
    index,
    indexDir: targetIndexDir,
    mode: 'code',
    manifestFiles: null,
    emitOutput: false,
    validateMode: 'off',
    vectorConfig: { enabled: false },
    modelConfig: { id: null },
    buildPragmas,
    optimize,
    stats
  });
  const durationMs = performance.now() - start;
  if (!fsSync.existsSync(targetPath)) {
    console.error('Expected sqlite DB to be created.');
    process.exit(1);
  }
  console.log(`[bench] build-from-artifacts ${label} chunks=${count} ms=${durationMs.toFixed(1)}`);
  if (stats.pragmas) {
    console.log(`[bench] ${label} pragmas`, stats.pragmas);
  }
  if (stats.tables) {
    console.log(`[bench] ${label} tables`, stats.tables);
  }
  return { count, durationMs };
};

let baselineResult = null;
let currentResult = null;
if (mode !== 'current') {
  const baselineIndex = await buildBaselineIndex();
  baselineResult = await runBuild({
    label: 'baseline',
    outPath: outPathBaseline,
    index: baselineIndex,
    indexDir: baselineIndexDir,
    buildPragmas: false,
    optimize: false
  });
}
if (mode !== 'baseline') {
  const indexPieces = await loadIndexPieces(indexDir, null);
  currentResult = await runBuild({
    label: 'current',
    outPath: outPathCurrent,
    index: indexPieces,
    indexDir,
    buildPragmas: true,
    optimize: true
  });
}
if (baselineResult && currentResult) {
  const deltaMs = currentResult.durationMs - baselineResult.durationMs;
  const deltaPct = baselineResult.durationMs > 0
    ? (deltaMs / baselineResult.durationMs) * 100
    : null;
  console.log(`[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct?.toFixed(1)}%)`);
}
