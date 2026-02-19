#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesFile, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { encodePackedOffsets, packTfPostings } from '../../../src/shared/packed-postings.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite packed token_postings test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-token-postings-packed-fastpath');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const chunks = [
  {
    id: 0,
    file: 'src/a.js',
    start: 0,
    end: 8,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    name: 'a',
    tokens: ['alpha', 'beta', 'alpha']
  },
  {
    id: 1,
    file: 'src/b.js',
    start: 0,
    end: 6,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    name: 'b',
    tokens: ['beta']
  }
];
await writeJsonLinesFile(path.join(indexDir, 'chunk_meta.jsonl'), chunks, { atomic: true });

const vocab = ['alpha', 'beta'];
const postings = [
  [[0, 2]],
  [[0, 1], [1, 1]]
];
const docLengths = [3, 1];
const packed = packTfPostings(postings);
const offsets = encodePackedOffsets(packed.offsets);
await fs.writeFile(path.join(indexDir, 'token_postings.packed.bin'), packed.buffer);
await fs.writeFile(path.join(indexDir, 'token_postings.packed.offsets.bin'), offsets);
await writeJsonObjectFile(path.join(indexDir, 'token_postings.packed.meta.json'), {
  fields: {
    totalDocs: 2,
    avgDocLen: 2,
    blockSize: packed.blockSize,
    offsets: 'token_postings.packed.offsets.bin'
  },
  arrays: {
    vocab,
    docLengths
  },
  atomic: true
});

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect streamed chunk meta');
assert.equal(indexPieces.chunkMeta, null, 'expected chunkMeta to remain streamed');

const warnings = [];
const count = await buildDatabaseFromArtifacts({
  Database,
  outPath,
  index: indexPieces,
  indexDir,
  mode: 'code',
  manifestFiles: null,
  emitOutput: true,
  validateMode: 'off',
  vectorConfig: { enabled: false },
  modelConfig: { id: null },
  logger: {
    warn: (message) => warnings.push(String(message || '')),
    log: () => {},
    error: () => {}
  }
});
assert.equal(count, chunks.length, 'expected sqlite build to ingest all chunks');
assert.equal(
  warnings.some((message) => message.includes('token_postings missing; rebuilding tokens')),
  false,
  'expected packed token_postings ingest to avoid chunk-based rebuild fallback'
);

const db = new Database(outPath);
try {
  const vocabTotal = db.prepare('SELECT COUNT(*) AS total FROM token_vocab WHERE mode = ?').get('code')?.total || 0;
  const postingTotal = db.prepare('SELECT COUNT(*) AS total FROM token_postings WHERE mode = ?').get('code')?.total || 0;
  const lengthsTotal = db.prepare('SELECT COUNT(*) AS total FROM doc_lengths WHERE mode = ?').get('code')?.total || 0;
  assert.equal(vocabTotal, vocab.length, 'expected packed token vocab to ingest');
  assert.equal(postingTotal, 3, 'expected packed token postings row count');
  assert.equal(lengthsTotal, docLengths.length, 'expected packed doc lengths to ingest');
} finally {
  db.close();
}

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite token_postings packed fastpath test passed');
