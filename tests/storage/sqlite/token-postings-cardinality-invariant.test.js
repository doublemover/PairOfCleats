#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildDatabaseFromArtifacts } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { setupTokenPostingsArtifactFixture } from './helpers/token-postings-streamed-fixture.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite token_postings cardinality invariant test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const { indexDir, outPath, indexPieces } = await setupTokenPostingsArtifactFixture({
  tempLabel: 'sqlite-token-postings-cardinality-invariant',
  chunks: [{
    id: 0,
    file: 'src/example.js',
    start: 0,
    end: 16,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    name: 'example',
    tokens: ['alpha', 'beta']
  }],
  tokenPostings: {
    sharded: {
      part: {
        arrays: {
          vocab: ['alpha'],
          postings: [
            [[0, 1]],
            [[0, 1]]
          ]
        }
      },
      meta: {
        fields: {
          avgDocLen: 2,
          totalDocs: 1,
          format: 'sharded',
          shardSize: 1,
          vocabCount: 1,
          parts: ['token_postings.shards/token_postings.part-00000.json']
        },
        arrays: {
          docLengths: [2]
        }
      }
    }
  },
  pieceEntries: [
    { name: 'chunk_meta', path: 'chunk_meta.jsonl', format: 'jsonl' },
    { name: 'token_postings', path: 'token_postings.shards/token_postings.part-00000.json', format: 'sharded' },
    { name: 'token_postings_meta', path: 'token_postings.meta.json', format: 'json' }
  ]
});
assert.ok(indexPieces, 'expected loadIndexPieces to detect chunk_meta/token_postings artifacts');

const warnings = [];
await assert.rejects(
  () => buildDatabaseFromArtifacts({
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
  }),
  /cardinality invariant failed/i,
  'expected sqlite build to fail closed when token_postings shard cardinality is invalid'
);

assert.equal(
  warnings.some((message) => message.includes('cardinality invariant failed')),
  true,
  'expected sqlite token_postings cardinality diagnostics to be emitted'
);

console.log('sqlite token_postings cardinality invariant test passed');
