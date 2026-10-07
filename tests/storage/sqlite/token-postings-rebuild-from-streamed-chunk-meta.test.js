#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildStreamedTokenPostingsDatabase,
  loadSqliteDatabase,
  loadStreamedTokenPostingsIndexPieces,
  readTokenPostingTableTotals,
  setupStreamedTokenPostingsFixture
} from './helpers/token-postings-streamed-fixture.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite streamed token_postings rebuild test requires better-sqlite3' });

const Database = await loadSqliteDatabase();
const { chunks, indexDir, outPath } = await setupStreamedTokenPostingsFixture({
  tempLabel: 'sqlite-token-postings-rebuild-from-streamed-chunk-meta'
});

const indexPieces = await loadStreamedTokenPostingsIndexPieces(indexDir);
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta jsonl stream');
assert.equal(indexPieces.chunkMeta, null, 'expected streaming chunk_meta load to avoid materializing chunk array');

const { count, warnings } = await buildStreamedTokenPostingsDatabase({
  Database,
  indexPieces,
  indexDir,
  outPath
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

const { vocabTotal, postingTotal, lengthsTotal } = readTokenPostingTableTotals({ Database, outPath });
assert.equal(vocabTotal, 2, 'expected rebuilt token vocab to include alpha and beta');
assert.equal(postingTotal, 3, 'expected rebuilt token postings rows for both documents');
assert.equal(lengthsTotal, chunks.length, 'expected rebuilt doc lengths for each chunk');

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite token_postings rebuild from streamed chunk_meta test passed');
