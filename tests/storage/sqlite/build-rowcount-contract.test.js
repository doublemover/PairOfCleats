#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';

import { setupSqliteBuildFixture } from './helpers/build-fixture.js';

const mode = 'code';
const chunkCount = 200;
const fileCount = 5;
const fixture = await setupSqliteBuildFixture({
  tempLabel: 'sqlite-build-rowcount-contract',
  chunkCount,
  fileCount,
  mode,
  includeRowcountArtifacts: true
});

assert.ok(fixture.indexPieces, 'expected loadIndexPieces to detect chunk_meta artifacts');
assert.equal(fixture.count, chunkCount, 'expected sqlite build to ingest chunk_meta count');
assert.ok(fsSync.existsSync(fixture.outPath), 'expected sqlite DB to be created');

const db = new fixture.Database(fixture.outPath);
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
assert.equal(countMode('phrase_postings'), fixture.phraseDocIds.length, 'phrase_postings rowcount mismatch');

assert.equal(countMode('chargram_vocab'), 2, 'chargram_vocab rowcount mismatch');
assert.equal(countMode('chargram_postings'), 5, 'chargram_postings rowcount mismatch');

assert.equal(countMode('minhash_signatures'), chunkCount, 'minhash_signatures rowcount mismatch');
assert.equal(countMode('dense_meta'), 0, 'dense_meta rowcount mismatch');
assert.equal(countMode('dense_vectors'), 0, 'dense_vectors rowcount mismatch');
assert.equal(countMode('file_manifest'), fileCount, 'file_manifest rowcount mismatch');

db.close();

console.log('sqlite build rowcount contract test passed');

