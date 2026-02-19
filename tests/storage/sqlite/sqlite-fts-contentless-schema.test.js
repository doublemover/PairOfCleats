#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
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
const tempRoot = path.join(root, '.testCache', 'sqlite-fts-contentless-schema');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 50;
const tokens = ['hello', 'world'];
const chunkIterator = function* chunkIterator() {
  for (let i = 0; i < chunkCount; i += 1) {
    yield {
      id: i,
      file: `src/file-${i % 3}.js`,
      start: 0,
      end: 10,
      startLine: 1,
      endLine: 1,
      kind: 'code',
      name: `fn${i}`,
      tokens,
      docmeta: {
        signature: `sig:${i}`,
        doc: `hello world ${i}`
      }
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
    vocab: ['hello'],
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
await writePiecesManifest(indexDir, [
  ...shardResult.parts.map((part) => ({
    name: 'chunk_meta',
    path: part,
    format: 'jsonl'
  })),
  { name: 'chunk_meta_meta', path: 'chunk_meta.meta.json', format: 'json' },
  {
    name: 'token_postings',
    path: 'token_postings.shards/token_postings.part-00000.json',
    format: 'sharded'
  },
  { name: 'token_postings_meta', path: 'token_postings.meta.json', format: 'json' }
]);

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta parts');

await buildDatabaseFromArtifacts({
  Database,
  outPath,
  index: indexPieces,
  indexDir,
  mode: 'code',
  manifestFiles: null,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  statementStrategy: 'prepared',
  optimize: false,
  buildPragmas: false
});

assert.ok(fsSync.existsSync(outPath), 'expected sqlite DB to be created');

const db = new Database(outPath);
const createRow = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chunks_fts'")
  .get();
assert.equal(typeof createRow?.sql, 'string', 'expected sqlite_master SQL for chunks_fts');
assert.match(createRow.sql, /content\s*=\s*''/i, 'expected chunks_fts to be contentless');
assert.match(createRow.sql, /contentless_delete\s*=\s*1/i, 'expected contentless_delete=1');

const matches = db.prepare('SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?').all('hello');
assert.ok(matches.length > 0, 'expected FTS MATCH to find inserted rows');

const probe = db.prepare('SELECT doc FROM chunks_fts WHERE rowid = ?').get(matches[0].rowid);
assert.equal(probe?.doc, null, 'expected contentless FTS doc column to return null');

// Verify incremental delete semantics are supported for contentless FTS.
db.prepare('DELETE FROM chunks_fts WHERE rowid = ?').run(matches[0].rowid);

db.close();

console.log('sqlite fts contentless schema test passed');

