#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { compactDatabase } from '../../../tools/build/compact-sqlite-index.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { setupSqliteBuildFixture } from './helpers/build-fixture.js';

const fixture = await setupSqliteBuildFixture({
  tempLabel: 'sqlite-compact-metadata-roundtrip', chunkCount: 3, fileCount: 2,
  decorateChunk: (chunk, index) => ({
    chunk_id: `chunk:${index}`,
    metaV2: { chunkId: `chunk:${index}`, file: chunk.file, lang: 'javascript',
      ext: '.js', range: { start: chunk.start, end: chunk.end },
      relations: { calls: [{ targetChunkId: 'chunk:external' }] }, segment: null },
    ext: '.js', headline: `headline ${index}`, preContext: ['before'], postContext: ['after'],
    weight: 2, ngrams: ['alpha beta'], codeRelations: { calls: ['external'] },
    docmeta: { signature: `fn${index}()`, doc: `alpha beta ${index}` },
    stats: { lines: 1 }, complexity: { cyclomatic: 1 }, lint: [{ message: 'fixture' }],
    externalDocs: [{ url: 'https://example.invalid/fixture' }],
    last_modified: '2026-10-06T00:00:00.000Z', last_author: 'fixture',
    churn: 3, churn_added: 2, churn_deleted: 1, churn_commits: 1,
    chunk_authors: ['fixture']
  })
});
const readRows = (file = fixture.outPath) => {
  const db = new fixture.Database(file, { readonly: true });
  try { return db.prepare('SELECT * FROM chunks ORDER BY id').all(); }
  finally { db.close(); }
};
const before = readRows();
const byChunk = new Map(before.map(row => [row.chunk_id, row]));
const logger = { log() {}, warn() {}, error(message) { throw new Error(message); } };
try {
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const result = await compactDatabase({ dbPath: fixture.outPath, mode: 'code',
      vectorExtension: { enabled: false }, keepBackup: true, logger });
    assert.equal(result.skipped, false);
    const after = readRows();
    assert.equal(after.length, before.length);
    assert.deepEqual(after.map(row => row.id), [0, 1, 2]);
    assert.deepEqual(after.map(row => row.chunk_id), ['chunk:0', 'chunk:2', 'chunk:1'],
      'compaction must reassign local IDs without changing stable chunk identity');
    for (const row of after) {
      const expected = byChunk.get(row.chunk_id);
      assert.ok(row.metaV2_json, 'compaction must preserve metadata required by retrieval');
      assert.deepEqual({ ...row, id: expected.id }, expected,
        'every persisted chunk column must survive compaction');
    }
    const db = new fixture.Database(fixture.outPath, { readonly: true });
    try {
      const helpers = createSqliteHelpers({ getDb: () => db });
      const loaded = helpers.loadIndexFromSqlite('code', { includeDense: false, includeMinhash: false,
        includeFilterIndex: false });
      assert.deepEqual(loaded.chunkMeta.map(chunk => chunk.metaV2.chunkId),
        ['chunk:0', 'chunk:2', 'chunk:1']);
    } finally { db.close(); }
  }
  assert.deepEqual(readRows(`${fixture.outPath}.bak`), before, 'original backup remains recoverable');
  const stableBytes = await fs.readFile(fixture.outPath);
  await compactDatabase({ dbPath: fixture.outPath, mode: 'code', vectorExtension: { enabled: false },
    dryRun: true, logger });
  assert.deepEqual(await fs.readFile(fixture.outPath), stableBytes, 'dry-run must preserve source bytes');
  console.log('SQLite compaction preserves all chunk columns, retrieval metadata, backups and repeatability.');
} finally {
  await fs.rm(fixture.tempRoot, { recursive: true, force: true });
}
