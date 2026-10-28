import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureSqliteChunkStageIdentity, readSqliteChunkIdentity, matchesSqliteChunkIdentity } from '../../../../src/storage/sqlite/build/row-identity.js';
import { createSqliteModeRowLedger, validateSqliteRowLedgerPostImport } from '../../../../src/storage/sqlite/build/runner/row-ledger.js';
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from '../../../../src/storage/sqlite/schema.js';
import { writeSqliteIndexFormat } from '../../../../src/storage/sqlite/index-format.js';
import { resolveRepoCacheRootPath } from '../../../../src/shared/repo-paths.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { errorGraphIncludes } from '../../../helpers/error-graph.js';

// UNVALIDATED: actual source-stage SQL, streaming hashes, private witnesses and
// post-import native transaction. No subprocess, symlink or permission change.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['stage-positive', 'stage-missing', 'stage-id', 'stage-file', 'stage-range', 'stage-uid', 'stage-mode',
  'stage-meta', 'stage-duplicate', 'stage-invalid-id', 'stage-bounded-samples', 'post-uid', 'post-file', 'post-range',
  'post-id', 'post-meta', 'post-extra', 'post-missing', 'foreign-target', 'foreign-mode', 'copied-witness',
  'cursor-primary-and-return', 'cursor-pending-step', 'cursor-pending-return', 'cursor-replacement',
  'native-build-positive', 'native-build-corrupt', 'native-build-no-stats', 'native-bundle-no-stats', 'fallback-target', 'forged-probe'].includes(selected));
if (selected.startsWith('cursor-')) {
  const primary = Object.freeze(new Error('original cursor next failure')), secondary = Object.freeze(new Error('original cursor return failure'));
  let ready = false, nexts = 0, returns = 0, failure;
  const step = Object.freeze({ done: false, cacheOwnershipReleased: () => ready });
  const returned = Object.freeze({ done: true, cacheOwnershipReleased: () => ready });
  const iterator = {
    next() {
      nexts++;
      if (selected === 'cursor-replacement') { iterator.return = () => assert.fail('late cursor return cannot replace its original'); return { value: { id: -1 }, done: false }; }
      if (selected === 'cursor-pending-step') return step;
      throw primary;
    },
    return() { returns++; if (selected === 'cursor-primary-and-return') throw secondary; return selected === 'cursor-pending-return' ? returned : { done: true }; }
  };
  const db = { prepare: () => ({ iterate: () => iterator }) };
  assert.throws(() => readSqliteChunkIdentity(db, 'code'), error => { failure = error; return true; });
  assert.equal(nexts, 1); assert.equal(returns, 1);
  if (selected === 'cursor-primary-and-return') {
    assert.equal(errorGraphIncludes(failure, primary), true); assert.equal(errorGraphIncludes(failure, secondary), true);
  }
  if (selected.startsWith('cursor-pending-')) {
    assert.equal(errorGraphIncludes(failure, selected === 'cursor-pending-step' ? step : returned), true);
    assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
} else {
  const { default: Database } = await import('better-sqlite3');
  const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-row-identity-${selected}`);
  let passed = false;
  if (selected === 'native-bundle-no-stats') {
    const { writeSingleChunkBundle, createBundleManifest, buildBundleDatabase } = await import('../helpers/bundle-fixture.js');
    const bundleDir = path.join(root, 'bundles'), target = path.join(root, 'bundle.db'); await fs.mkdir(bundleDir);
    await writeSingleChunkBundle({ bundleDir, bundleName: 'source.json', file: 'source.js', chunk: {
      file: 'source.js', start: 0, end: 10, startLine: 1, endLine: 1, kind: 'code', name: 'source', tokens: ['source']
    } });
    const manifest = createBundleManifest([{ file: 'source.js', bundles: ['source.json'], hash: 'source-hash', size: 10, mtimeMs: 1 }]);
    const result = await buildBundleDatabase({ Database, dbPath: target, mode: 'code', manifest, bundleDir });
    assert.equal(result.count, 1);
    const readback = new Database(target, { readonly: true });
    try { assert.equal(readback.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1); } finally { readback.close(); }
    passed = true;
  } else if (selected.startsWith('native-build-')) {
    const repoRoot = path.join(root, 'repo'), cache = path.join(root, 'cache'), home = path.join(root, 'home'); await fs.mkdir(repoRoot);
    applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
    const { createBaseIndex, defaultUserConfig } = await import('../../../indexing/validate/helpers.js');
    const { buildSqliteIndex } = await import('../../../../src/storage/sqlite/build/runner.js');
    const userConfig = { ...defaultUserConfig, cache: { root: cache } }, repo = resolveRepoCacheRootPath(repoRoot, userConfig);
    const indexRoot = path.join(repo, 'builds', 'generation'), indexDir = path.join(indexRoot, 'index-code');
    const output = path.join(indexRoot, 'index-sqlite', 'index-code.db'); await fs.mkdir(path.dirname(output), { recursive: true });
    const source = await createBaseIndex({ rootDir: repoRoot, semantic: true }); await fs.cp(source.indexDir, indexDir, { recursive: true });
    const old = new Database(output);
    try {
      old.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(old); old.pragma(`user_version = ${SCHEMA_VERSION}`);
      old.prepare('INSERT INTO chunks (id, mode, chunk_id, file, start, end) VALUES (0, ?, ?, ?, 0, 1)').run('code', 'old-uid', 'old.js');
    } finally { old.close(); }
    const originalExec = Database.prototype.exec; let injected = 0, failed = false;
    Database.prototype.exec = function (sql, ...args) {
      const value = originalExec.call(this, sql, ...args);
      if (selected === 'native-build-corrupt' && this.name !== output && this.name.startsWith(path.dirname(output))
        && sql.includes('INSERT OR REPLACE INTO chunks (') && sql.includes('FROM chunks_stage c')) {
        this.prepare('UPDATE chunks SET chunk_id = ? WHERE mode = ?').run('corrupted-equal-count-uid', 'code'); injected++;
      }
      return value;
    };
    try {
      try {
        if (selected === 'native-build-no-stats') {
          const { buildDatabaseFromArtifacts } = await import('../../../../src/storage/sqlite/build/from-artifacts.js');
          assert.equal(await buildDatabaseFromArtifacts({ Database, repoRoot, indexDir, outputPath: output, mode: 'code',
            storageContext: { repoRoot, userConfig }, emitOutput: false, validateMode: 'off', vectorConfig: { enabled: false } }), 1);
        } else {
          const result = await buildSqliteIndex({ root: repoRoot, userConfig, mode: 'code', indexRoot, codeDir: indexDir,
            out: output, compact: false, validateMode: 'off', emitOutput: false, logger: { log() {}, warn() {}, error() {} } });
          assert.equal(result.ok, true);
        }
      } catch (error) { failed = true; assert.equal(selected, 'native-build-corrupt'); assert.equal(error.code, 'ERR_SQLITE_ROW_IDENTITY_MISMATCH'); }
      assert.equal(failed, selected === 'native-build-corrupt');
      const readback = new Database(output, { readonly: true });
      try {
        assert.equal(readback.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
        if (failed) { assert.equal(readback.prepare('SELECT chunk_id FROM chunks').get().chunk_id, 'old-uid'); assert.equal(injected, 1); }
        else assert.notEqual(readback.prepare('SELECT chunk_id FROM chunks').get().chunk_id, 'old-uid');
      } finally { readback.close(); }
      passed = true;
    } finally { Database.prototype.exec = originalExec; }
  } else {
    const target = path.join(root, 'identity.db'), db = new Database(target), metadata = '{"fileHash":"source-hash"}';
    try {
      db.exec(CREATE_TABLES_SQL); writeSqliteIndexFormat(db); db.pragma(`user_version = ${SCHEMA_VERSION}`);
      db.exec(`CREATE TEMP TABLE chunks_stage (id INTEGER, chunk_id TEXT, mode TEXT, file_id INTEGER, file TEXT,
        start INTEGER, end INTEGER, startLine INTEGER, endLine INTEGER, metaV2_json TEXT);
        CREATE TEMP TABLE file_meta_stage (id INTEGER PRIMARY KEY, file TEXT);`);
      db.prepare('INSERT INTO file_meta_stage VALUES (1, ?)').run('source.js');
      const stage = db.prepare('INSERT INTO chunks_stage VALUES (?, ?, ?, 1, NULL, 0, 10, 1, 2, ?)');
      const actual = db.prepare('INSERT INTO chunks (id, chunk_id, mode, file, start, end, startLine, endLine, metaV2_json) VALUES (?, ?, ?, ?, 0, 10, 1, 2, ?)');
      const rows = selected === 'stage-bounded-samples' ? 20 : 1;
      for (let id = 0; id < rows; id++) {
        stage.run(id, `uid:${id}`, 'code', metadata);
        actual.run(id, selected === 'stage-bounded-samples' ? `wrong:${id}` : `uid:${id}`, 'code', 'source.js', metadata);
      }
      db.prepare('INSERT INTO file_manifest (mode, file, hash, chunk_count) VALUES (?, ?, ?, ?)').run('code', 'source.js', 'source-hash', rows);
      const mutate = kind => {
        if (kind === 'missing') db.prepare('DELETE FROM chunks').run();
        else if (kind === 'id') db.prepare('UPDATE chunks SET id = 3').run();
        else if (kind === 'file') db.prepare('UPDATE chunks SET file = ?').run('another.js');
        else if (kind === 'range') db.prepare('UPDATE chunks SET end = 11').run();
        else if (kind === 'uid') db.prepare('UPDATE chunks SET chunk_id = ?').run('another-uid');
        else if (kind === 'mode') db.prepare('UPDATE chunks SET mode = ?').run('prose');
        else if (kind === 'meta') db.prepare('UPDATE chunks SET metaV2_json = ?').run('{"fileHash":"different-source"}');
        else if (kind === 'extra') actual.run(4, 'extra', 'code', 'source.js', metadata);
      };
      const stageFailure = selected.startsWith('stage-') && selected !== 'stage-positive';
      if (stageFailure) {
        if (selected === 'stage-duplicate') stage.run(0, 'uid:0', 'code', metadata);
        else if (selected === 'stage-invalid-id') db.prepare('UPDATE chunks_stage SET id = -1').run();
        else if (selected !== 'stage-bounded-samples') mutate(selected.slice('stage-'.length));
        assert.throws(() => captureSqliteChunkStageIdentity(db, 'code'), error => {
          if (selected === 'stage-bounded-samples') { assert.equal(error.rowIdentity.samples.length, 16); assert.equal(error.rowIdentity.truncated, true); }
          return error.code === 'ERR_SQLITE_ROW_IDENTITY_MISMATCH';
        });
      } else {
        const logical = selected === 'fallback-target' ? path.join(root, 'selected-publication.db') : target;
        const witness = captureSqliteChunkStageIdentity(db, 'code', { outputPath: logical });
        assert.equal(Object.isFrozen(witness), true); assert.equal(witness.count, 1);
        db.exec('DELETE FROM chunks_stage; DELETE FROM file_meta_stage;');
        if (selected.startsWith('post-')) mutate(selected.slice('post-'.length));
        if (selected === 'forged-probe') {
          let called = false;
          assert.throws(() => validateSqliteRowLedgerPostImport({ Database, dbPath: target,
            rowLedger: createSqliteModeRowLedger({ mode: 'code', expectedChunkCount: 1, expectedDenseCount: 0 }), chunkIdentity: witness,
            probe: { readSnapshot: () => { called = true; return { chunks: 1, dense: 0, files: 1, ann: null, chunkIdentity: witness }; } }
          }), { code: 'ERR_SQLITE_ROW_IDENTITY_MISMATCH' });
          assert.equal(called, false);
        } else if (selected === 'fallback-target') {
          const identity = readSqliteChunkIdentity(db, 'code');
          assert.equal(matchesSqliteChunkIdentity(witness, identity, logical, 'code'), true);
          assert.equal(matchesSqliteChunkIdentity(witness, identity, target, 'code'), false);
        } else if (selected === 'foreign-target') assert.equal(matchesSqliteChunkIdentity(witness, readSqliteChunkIdentity(db, 'code'), path.join(root, 'foreign.db'), 'code'), false);
        else if (selected === 'foreign-mode') assert.equal(matchesSqliteChunkIdentity(witness, readSqliteChunkIdentity(db, 'code'), target, 'prose'), false);
        else if (selected === 'copied-witness') assert.equal(matchesSqliteChunkIdentity(JSON.parse(JSON.stringify(witness)), readSqliteChunkIdentity(db, 'code'), target, 'code'), false);
        else {
          const identity = readSqliteChunkIdentity(db, 'code');
          assert.equal(matchesSqliteChunkIdentity(witness, identity, target, 'code'), !selected.startsWith('post-'));
          const result = validateSqliteRowLedgerPostImport({ Database, dbPath: target, mode: 'code',
            rowLedger: createSqliteModeRowLedger({ mode: 'code', expectedChunkCount: 1, expectedDenseCount: 0 }),
            annExpectation: 'disabled', chunkIdentity: witness });
          assert.equal(result.ok, !selected.startsWith('post-'));
          if (result.ok) assert.equal(result.coverage.identities, 'normalized-artifact-stage-chunks');
          if (['post-uid', 'post-file', 'post-range', 'post-id', 'post-meta'].includes(selected)) assert.equal(result.code, 'ERR_SQLITE_POSTIMPORT_IDENTITY_MISMATCH');
        }
      }
      passed = true;
    } finally { db.close(); }
  }
  if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
}
console.log(`SQLite original artifact row identity: ${selected}`);
