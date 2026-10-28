import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compactDatabase, getSqliteCompactionChunkIdentity } from '../../../tools/build/compact-sqlite-index.js';
import { captureSqliteCompactionChunkIdentity, matchesSqliteChunkIdentity, readSqliteChunkIdentity } from '../../../src/storage/sqlite/build/row-identity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { setupSqliteBuildFixture } from './helpers/build-fixture.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// UNVALIDATED: tiny actual SQLite/source-corruption controls, no optional ANN.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['planned-renumbering', 'copied-result', 'uid-copy', 'file-copy', 'range-copy', 'metadata-copy',
  'post-vacuum-change', 'missing-file', 'orphan-dense', 'source-query-failure', 'invalid-source-id',
  'shared-chunks', 'shared-empty-manifest', 'shared-null-mode', 'shared-doc-lengths', 'missing-normalizer'];
assert.ok(cases.includes(selected));
const fixture = await setupSqliteBuildFixture({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  tempLabel: `compact-source-${selected}-${process.pid}-${Date.now()}`, chunkCount: 3, fileCount: 2,
  decorateChunk: (chunk, index) => ({ chunk_id: `uid:${index}`, start: index * 10, end: index * 10 + 10 }) });
const { Database, outPath, tempRoot } = fixture;
const prepare = Database.prototype.prepare, exec = Database.prototype.exec;
let passed = false, failure = null, mutated = false;
const primary = Object.freeze(new Error('exact original compaction source identity query failure'));
try {
  const populate = new Database(outPath);
  try {
    for (const row of populate.prepare('SELECT id FROM chunks ORDER BY id').all()) {
      populate.prepare('INSERT INTO dense_vectors(mode,doc_id,vector) VALUES (?,?,?)').run('code', row.id, Buffer.from([row.id + 1]));
    }
    if (selected === 'invalid-source-id') populate.prepare('UPDATE chunks SET id=-1 WHERE id=0').run();
    if (selected === 'shared-chunks') populate.prepare('INSERT INTO chunks(id,mode,file) VALUES(99,?,?)').run('prose', 'other.md');
    if (selected === 'shared-null-mode') populate.prepare('INSERT INTO chunks(id,mode,file) VALUES(99,NULL,?)').run('unknown.txt');
    if (selected === 'shared-empty-manifest') populate.prepare('INSERT INTO file_manifest(mode,file,chunk_count) VALUES(?,?,0)').run('prose', 'empty.md');
    if (selected === 'shared-doc-lengths') populate.prepare('INSERT INTO doc_lengths(mode,doc_id,len) VALUES(?,?,0)').run('prose', 99);
  } finally { populate.close(); }
  const originalBytes = await fs.readFile(outPath);
  Database.prototype.prepare = function (sql, ...args) {
    if (selected === 'source-query-failure' && this.name === outPath && sql.startsWith('SELECT id, chunk_id, mode, file,')) throw primary;
    const statement = prepare.call(this, sql, ...args);
    if (selected.endsWith('-copy') && this.name.includes('.compact-') && sql.includes('INSERT OR REPLACE INTO chunks (')) {
      const run = statement.run.bind(statement);
      statement.run = row => {
        const actual = { ...row }; mutated = true;
        if (selected === 'uid-copy') actual.chunk_id = 'wrong-uid';
        if (selected === 'file-copy') actual.file = 'wrong-file.js';
        if (selected === 'range-copy') actual.end++;
        if (selected === 'metadata-copy') actual.metaV2_json = '{"different":true}';
        return run(actual);
      };
    }
    return statement;
  };
  Database.prototype.exec = function (sql, ...args) {
    const result = exec.call(this, sql, ...args);
    if (sql === 'VACUUM' && this.name.includes('.compact-')) {
      if (selected === 'post-vacuum-change') { prepare.call(this, 'UPDATE chunks SET chunk_id=? WHERE id=0').run('changed-after-vacuum'); mutated = true; }
      if (selected === 'missing-file') { prepare.call(this, 'DELETE FROM file_manifest WHERE mode=?').run('code'); mutated = true; }
      if (selected === 'orphan-dense') { prepare.call(this, 'INSERT INTO dense_vectors(mode,doc_id,vector) VALUES(?,?,?)').run('code', 999, Buffer.from([9])); mutated = true; }
    }
    return result;
  };
  if (selected === 'missing-normalizer') {
    assert.throws(() => captureSqliteCompactionChunkIdentity({ name: outPath }, 'code'), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH' });
  } else {
    let result;
    try { result = await compactDatabase({ dbPath: outPath, mode: 'code', vectorExtension: { enabled: false }, logger: { log() {}, warn() {} } }); }
    catch (error) { failure = error; }
    if (selected === 'planned-renumbering' || selected === 'copied-result') {
      assert.equal(failure, null); assert.deepEqual(result, { skipped: false }, 'public result shape remains unchanged');
      const identity = getSqliteCompactionChunkIdentity(result); assert.ok(identity);
      assert.equal(getSqliteCompactionChunkIdentity({ ...result }), null); assert.equal(getSqliteCompactionChunkIdentity(JSON.parse(JSON.stringify(result))), null);
      const readback = new Database(outPath, { readonly: true });
      try {
        assert.equal(matchesSqliteChunkIdentity(identity, readSqliteChunkIdentity(readback, 'code'), outPath, 'code'), true);
        assert.deepEqual(readback.prepare('SELECT chunk_id FROM chunks ORDER BY id').all().map(row => row.chunk_id), ['uid:0', 'uid:2', 'uid:1']);
        const vectors = readback.prepare('SELECT c.chunk_id, d.vector FROM chunks c JOIN dense_vectors d ON c.id=d.doc_id AND c.mode=d.mode ORDER BY c.id').all();
        assert.deepEqual(vectors.map(row => [row.chunk_id, [...row.vector]]), [['uid:0', [1]], ['uid:2', [3]], ['uid:1', [2]]]);
      } finally { readback.close(); }
    } else {
      assert.ok(failure, `${selected} must refuse publication`);
      if (selected.startsWith('shared-')) assert.equal(failure.code, 'ERR_SQLITE_COMPACTION_UNSUPPORTED');
      else if (selected === 'source-query-failure') assert.ok(errorGraphIncludes(failure, primary));
      else if (selected === 'invalid-source-id') assert.equal(failure.code, 'ERR_SQLITE_ROW_IDENTITY_MISMATCH');
      else {
        assert.equal(mutated, true);
        assert.equal(failure.code, ['missing-file', 'orphan-dense'].includes(selected)
          ? 'ERR_SQLITE_COMPACTION_CORRESPONDENCE_MISMATCH' : 'ERR_SQLITE_COMPACTION_IDENTITY_MISMATCH');
      }
      assert.deepEqual(await fs.readFile(outPath), originalBytes, 'failed correspondence leaves the original database intact');
      assert.equal((await fs.readdir(tempRoot)).some(name => name.includes('.compact-')), false);
    }
  }
  passed = true;
} finally {
  Database.prototype.prepare = prepare; Database.prototype.exec = exec;
  if (passed) { assert.ok(tempRoot.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(tempRoot, { recursive: true, force: true }); }
}
console.log(`SQLite compaction source identity and mode preservation: ${selected}`);
