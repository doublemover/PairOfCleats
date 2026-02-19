#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-token-postings-rebuild-from-streamed-chunk-meta');
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

const indexPieces = await loadIndexPieces(indexDir, null);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta jsonl stream');
assert.equal(indexPieces.chunkMeta, null, 'expected streaming chunk_meta load to avoid materializing chunk array');

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
assert.equal(count, chunks.length, 'expected sqlite build to ingest all streamed chunks');
assert.equal(
  warnings.some((message) => message.includes('chunk_meta unavailable for token rebuild')),
  false,
  'expected token rebuild to use persisted chunk rows instead of reporting chunk_meta unavailable'
);
assert.equal(
  warnings.some((message) => message.includes('token_postings missing; rebuilding tokens')),
  true,
  'expected missing token_postings warning to remain visible'
);

const db = new Database(outPath);
try {
  const vocabTotal = db.prepare('SELECT COUNT(*) AS total FROM token_vocab WHERE mode = ?').get('code')?.total || 0;
  const postingTotal = db.prepare('SELECT COUNT(*) AS total FROM token_postings WHERE mode = ?').get('code')?.total || 0;
  const lengthsTotal = db.prepare('SELECT COUNT(*) AS total FROM doc_lengths WHERE mode = ?').get('code')?.total || 0;
  assert.equal(vocabTotal, 2, 'expected rebuilt token vocab to include alpha and beta');
  assert.equal(postingTotal, 3, 'expected rebuilt token postings rows for both documents');
  assert.equal(lengthsTotal, chunks.length, 'expected rebuilt doc lengths for each chunk');
} finally {
  db.close();
}

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite token_postings rebuild from streamed chunk_meta test passed');
