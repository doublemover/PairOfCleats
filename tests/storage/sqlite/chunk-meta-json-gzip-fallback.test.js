#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite chunk_meta gzip fallback test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-chunk-meta-json-gzip-fallback');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunkCount = 24;
const chunks = Array.from({ length: chunkCount }, (_, i) => ({
  id: i,
  file: `src/file-${i % 4}.js`,
  start: 0,
  end: 10,
  startLine: 1,
  endLine: 1,
  kind: 'code',
  name: `fn${i}`,
  tokens: ['alpha', 'beta']
}));

await fs.writeFile(
  path.join(indexDir, 'chunk_meta.json.gz'),
  gzipSync(Buffer.from(JSON.stringify(chunks), 'utf8'))
);
await writeJsonObjectFile(path.join(indexDir, 'token_postings.json'), {
  fields: {
    avgDocLen: 2,
    totalDocs: chunkCount
  },
  arrays: {
    vocab: ['alpha', 'beta'],
    postings: [
      Array.from({ length: chunkCount }, (_, docId) => [docId, 1]),
      Array.from({ length: chunkCount }, (_, docId) => [docId, 1])
    ],
    docLengths: Array.from({ length: chunkCount }, () => 2)
  },
  atomic: true
});

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta.json.gz');
const count = await buildDatabaseFromArtifacts({
  Database,
  outPath,
  index: indexPieces,
  indexDir,
  mode: 'code',
  manifestFiles: null,
  emitOutput: false,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null }
});
assert.equal(count, chunkCount, 'expected sqlite build to ingest all chunks from gzip JSON artifact');

const db = new Database(outPath);
const row = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?').get('code');
assert.equal(row?.total, chunkCount, 'expected sqlite chunks table to match gzip chunk count');
db.close();

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite chunk_meta json gzip fallback test passed');
