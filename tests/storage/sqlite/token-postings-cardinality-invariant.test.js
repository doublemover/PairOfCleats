#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonLinesFile, writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { requireOrSkip } from '../../helpers/require-or-skip.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);
requireOrSkip({ capability: 'sqlite', reason: 'sqlite token_postings cardinality invariant test requires better-sqlite3' });

let Database = null;
({ default: Database } = await import('better-sqlite3'));

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-token-postings-cardinality-invariant');
const indexDir = path.join(tempRoot, 'index-code');
const outPath = path.join(tempRoot, 'index-code.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

await writeJsonLinesFile(path.join(indexDir, 'chunk_meta.jsonl'), [
  {
    id: 0,
    file: 'src/example.js',
    start: 0,
    end: 16,
    startLine: 1,
    endLine: 1,
    kind: 'code',
    name: 'example',
    tokens: ['alpha', 'beta']
  }
], { atomic: true });

const shardDir = path.join(indexDir, 'token_postings.shards');
await fs.mkdir(shardDir, { recursive: true });
await writeJsonObjectFile(path.join(shardDir, 'token_postings.part-00000.json'), {
  arrays: {
    vocab: ['alpha'],
    postings: [
      [[0, 1]],
      [[0, 1]]
    ]
  },
  atomic: true
});
await writeJsonObjectFile(path.join(indexDir, 'token_postings.meta.json'), {
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
  },
  atomic: true
});
await writePiecesManifest(indexDir, [
  { name: 'chunk_meta', path: 'chunk_meta.jsonl', format: 'jsonl' },
  { name: 'token_postings', path: 'token_postings.shards/token_postings.part-00000.json', format: 'sharded' },
  { name: 'token_postings_meta', path: 'token_postings.meta.json', format: 'json' }
]);

const indexPieces = await loadIndexPieces(indexDir, null);
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
