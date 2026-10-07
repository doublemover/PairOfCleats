#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildDatabaseFromArtifacts, loadIndexPieces } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { resolveTestCachePath } from '../../../helpers/test-cache.js';
import { writeSqliteShardFixtureArtifacts } from '../helpers/build-fixture.js';

applyTestEnv({ testing: '1' });
const tempRoot = resolveTestCachePath(process.cwd(), 'sqlite-multi-row-build-parity');
const indexDir = path.join(tempRoot, 'index-code');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });
const { pieceEntries } = await writeSqliteShardFixtureArtifacts({
  indexDir, chunkCount: 400, fileCount: 5, tokens: ['alpha', 'beta'],
  tokenVocab: ['alpha', 'beta'], chunkMaxBytes: 4096
});
await writePiecesManifest(indexDir, pieceEntries);

const tables = ['chunks', 'token_vocab', 'token_postings', 'doc_lengths', 'file_manifest', 'token_stats'];
const results = [];
for (const statementStrategy of ['prepared', 'multi-row']) {
  const calls = [];
  class ObservedDatabase extends Database {
    exec(sql) {
      calls.push(String(sql).trim());
      return super.exec(sql);
    }
  }
  const stats = {};
  const outPath = path.join(tempRoot, `${statementStrategy}.db`);
  const count = await buildDatabaseFromArtifacts({
    Database: ObservedDatabase, outPath, index: await loadIndexPieces(indexDir, null),
    indexDir, mode: 'code', manifestFiles: null, emitOutput: false,
    validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null },
    stats, statementStrategy, buildPragmas: false, optimize: false
  });
  assert.equal(count, 400);
  assert.equal(calls.filter((sql) => sql === 'BEGIN').length, 1);
  assert.equal(calls.filter((sql) => sql === 'COMMIT').length, 1);
  assert.equal(calls.filter((sql) => sql === 'ROLLBACK').length, 0);
  if (statementStrategy === 'multi-row') {
    assert(stats.multiRow.token_postings.runs > 1, 'fixture must cross actual multi-row statement batches');
  }
  const db = new Database(outPath, { readonly: true });
  try {
    results.push(Object.fromEntries(tables.map((table) => [table,
      db.prepare(`SELECT * FROM ${table}`).raw().all()
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    ])));
  } finally {
    db.close();
  }
}
assert.deepEqual(results[1], results[0], 'multi-row production ingestion must match prepared ingestion exactly');
console.log('native SQLite prepared/multi-row production build parity and transaction contracts passed');
