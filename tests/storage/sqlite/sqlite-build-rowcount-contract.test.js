#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-rowcount-contract');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const mode = 'code';
const chunkCount = 200;
const fileCount = 5;
const tokens = ['alpha', 'beta'];

const chunkIterator = function* chunkIterator() {
  for (let i = 0; i < chunkCount; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % fileCount}.js`,
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: mode,
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
  maxBytes: 4096,
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

const phraseDocIds = [];
for (let i = 0; i < chunkCount; i += 2) phraseDocIds.push(i);
await writeJsonObjectFile(path.join(indexDir, 'phrase_ngrams.json'), {
  arrays: {
    vocab: ['alpha beta'],
    postings: [phraseDocIds]
  },
  atomic: true
});

await writeJsonObjectFile(path.join(indexDir, 'chargram_postings.json'), {
  arrays: {
    vocab: ['ab', 'bc'],
    postings: [
      [0, 1, 2],
      [2, 3]
    ]
  },
  atomic: true
});

await writeJsonObjectFile(path.join(indexDir, 'minhash_signatures.json'), {
  arrays: {
    signatures: Array.from({ length: chunkCount }, (_, i) => [i, i + 1, i + 2])
  },
  atomic: true
});

await writeJsonObjectFile(path.join(indexDir, 'dense_vectors_uint8.json'), {
  fields: {
    dims: 2,
    model: 'stub',
    scale: 1.0
  },
  arrays: {
    vectors: Array.from({ length: chunkCount }, (_, i) => [i % 256, (i + 1) % 256])
  },
  atomic: true
});

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta artifacts');

const count = await buildDatabaseFromArtifacts({
  Database,
  outPath,
  index: indexPieces,
  indexDir,
  mode,
  manifestFiles: null,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  statementStrategy: 'prepared',
  buildPragmas: false,
  optimize: false
});

assert.equal(count, chunkCount, 'expected sqlite build to ingest chunk_meta count');
assert.ok(fsSync.existsSync(outPath), 'expected sqlite DB to be created');

const db = new Database(outPath);
const countMode = (table) => {
  if (table === 'chunks_fts') {
    return db.prepare('SELECT COUNT(*) AS total FROM chunks_fts').get()?.total ?? 0;
  }
  return db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE mode = ?`)
    .get(mode)?.total ?? 0;
};

assert.equal(countMode('chunks'), chunkCount, 'chunks rowcount mismatch');
assert.equal(countMode('chunks_fts'), chunkCount, 'chunks_fts rowcount mismatch');
assert.equal(countMode('doc_lengths'), chunkCount, 'doc_lengths rowcount mismatch');

assert.equal(countMode('token_vocab'), 1, 'token_vocab rowcount mismatch');
assert.equal(countMode('token_postings'), chunkCount, 'token_postings rowcount mismatch');
assert.equal(countMode('token_stats'), 1, 'token_stats rowcount mismatch');

assert.equal(countMode('phrase_vocab'), 1, 'phrase_vocab rowcount mismatch');
assert.equal(countMode('phrase_postings'), phraseDocIds.length, 'phrase_postings rowcount mismatch');

assert.equal(countMode('chargram_vocab'), 2, 'chargram_vocab rowcount mismatch');
assert.equal(countMode('chargram_postings'), 5, 'chargram_postings rowcount mismatch');

assert.equal(countMode('minhash_signatures'), chunkCount, 'minhash_signatures rowcount mismatch');
assert.equal(countMode('dense_meta'), 1, 'dense_meta rowcount mismatch');
assert.equal(countMode('dense_vectors'), chunkCount, 'dense_vectors rowcount mismatch');
assert.equal(countMode('file_manifest'), fileCount, 'file_manifest rowcount mismatch');

db.close();

console.log('sqlite build rowcount contract test passed');
