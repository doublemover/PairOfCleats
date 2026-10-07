#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import {
  buildTokenPostingsArtifactDatabase,
  setupTokenPostingsArtifactFixture
} from './helpers/token-postings-streamed-fixture.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const { indexDir, outPath, indexPieces } = await setupTokenPostingsArtifactFixture({
  tempLabel: 'sqlite-token-postings-duplicate-docids',
  chunks: [{
    id: 0,
    file: 'src/example.js',
    start: 0,
    end: 16,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    name: 'example',
    tokens: ['alpha', 'alpha', 'beta']
  }],
  tokenPostings: {
    json: {
      fields: {
        avgDocLen: 3,
        totalDocs: 1
      },
      arrays: {
        vocab: ['alpha'],
        // Duplicate entries for (doc=0) must be merged by sqlite ingest.
        postings: [
          [[0, 2], [0, 3], [0, 1]]
        ],
        docLengths: [3]
      }
    }
  }
});
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta/token_postings artifacts');

const count = await buildTokenPostingsArtifactDatabase({
  Database,
  indexPieces,
  indexDir,
  outPath
});
assert.equal(count, 1, 'expected sqlite build to ingest one chunk');

const db = new Database(outPath);
const tokenPosting = db.prepare(`
  SELECT tf
  FROM token_postings
  WHERE mode = ? AND token_id = ? AND doc_id = ?
`).get('code', 0, 0);
assert.equal(tokenPosting?.tf, 6, 'expected duplicate doc postings to be merged (2+3+1)');
db.close();

if (!fsSync.existsSync(outPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite token_postings duplicate doc ids test passed');
