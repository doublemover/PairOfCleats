import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openSqliteBuildDatabase, closeSqliteBuildDatabase } from '../../../../src/storage/sqlite/build/core.js';
import { buildDatabaseFromArtifacts } from '../../../../src/storage/sqlite/build/from-artifacts.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../src/contracts/versioning.js';
import { writeSqliteArtifactManifest } from '../../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('original-close-owner/')[1];
assert.ok(['initialization', 'late-method', 'unknown-close', 'constructor-pending', 'constructor-fatal', 'artifact-primary', 'bundle-primary'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-build-owner-${selected}`);
const outPath = path.join(dir, 'owned.db');
let database, closes = 0, opens = 0;
const primary = Object.freeze(new Error('original frozen SQLite build operation failed'));
const cleanup = Object.freeze(new Error('original SQLite writer close failed'));
const originalClose = Database.prototype.close;
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen));
};
function TrackingDatabase(file) {
  opens++;
  database = new Database(file);
  const pragma = database.pragma;
  const exec = database.exec;
  database.pragma = function (sql, ...args) {
    if (selected === 'initialization' && sql === 'page_size') throw primary;
    return pragma.call(this, sql, ...args);
  };
  database.close = function () {
    closes++;
    if (selected === 'initialization' || selected === 'unknown-close' || selected.endsWith('-primary')) throw cleanup;
    return originalClose.call(this);
  };
  database.exec = function (sql, ...args) {
    if (selected.endsWith('-primary') && sql.includes('CREATE INDEX idx_chunks_file_id')) throw primary;
    return exec.call(this, sql, ...args);
  };
  return database;
}
try {
  if (selected.startsWith('constructor-')) {
    const pending = selected === 'constructor-pending';
    const failed = Object.freeze(Object.assign(new Error('original constructor did not produce a handle'), {
      code: pending ? 'SQLITE_CANTOPEN' : 'EIO',
      ...(pending ? { cacheOwnershipPending: true, cacheOwnershipReleased: () => false } : {})
    }));
    assert.throws(() => openSqliteBuildDatabase({ Database: function () { opens++; throw failed; }, outPath, useBuildPragmas: false }),
      error => contains(error, failed));
    assert.equal(opens, 1, 'an unsettled or fatal original constructor cannot dispatch more native fallback attempts');
  } else if (selected.endsWith('-primary')) {
    const chunk = { id: 0, file: 'sample.js', start: 0, end: 1, tokens: [] };
    const common = { Database: TrackingDatabase, outPath, mode: 'code', emitOutput: false, validateMode: 'off',
      vectorConfig: { enabled: false }, modelConfig: { id: null }, buildPragmas: false, optimize: false };
    let operation;
    if (selected === 'artifact-primary') {
      const indexDir = path.join(dir, 'artifacts'); await fs.mkdir(indexDir);
      await writeSqliteArtifactManifest(indexDir, []);
      operation = buildDatabaseFromArtifacts({ ...common, indexDir, index: { chunkMeta: [chunk],
        tokenPostings: { vocab: [], postings: [], docLengths: [0], avgDocLen: 0, totalDocs: 1 } } });
    } else {
      await fs.writeFile(path.join(dir, 'bundle.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, chunks: [chunk] }));
      operation = buildDatabaseFromBundles({ ...common, incrementalData: { manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        files: { 'sample.js': { bundles: ['bundle.json'], hash: 'sample' } } }, bundleDir: dir },
      envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 } });
    }
    await assert.rejects(operation, error => contains(error, primary) && contains(error, cleanup) && error.cacheOwnershipReleased() === false);
    assert.equal(closes, 1); assert.equal(database.open, true); assert.equal(primary.nativeCleanupError, undefined);
    assert.ok((await fs.stat(outPath)).size >= 0, 'both failed builders retain their unconfirmed native output');
  } else if (selected === 'initialization') {
    assert.throws(() => openSqliteBuildDatabase({ Database: TrackingDatabase, outPath, useBuildPragmas: false }),
      error => contains(error, primary) && contains(error, cleanup) && error.cacheOwnershipReleased() === false);
    assert.equal(primary.nativeCleanupError, undefined); assert.equal(closes, 1); assert.equal(database.open, true);
  } else {
    const opened = openSqliteBuildDatabase({ Database: TrackingDatabase, outPath, useBuildPragmas: false });
    database.close = () => assert.fail('late replacement cannot own writer finalization');
    const input = { ...opened, outPath, succeeded: selected === 'late-method',
      operationFailed: selected === 'unknown-close', operationError: primary };
    const first = closeSqliteBuildDatabase(input);
    assert.equal(closeSqliteBuildDatabase(input), first, 'concurrent finalization joins its original operation');
    if (selected === 'unknown-close') {
      let failure;
      await assert.rejects(first, error => { failure = error; return contains(error, primary) && contains(error, cleanup); });
      assert.equal(database.open, true); assert.equal(failure.cacheOwnershipReleased(), false);
      assert.equal(closeSqliteBuildDatabase(input), first, 'an unknown original close remains sticky');
      await assert.rejects(closeSqliteBuildDatabase(input), error => error === failure);
      assert.ok((await fs.stat(outPath)).size >= 0, 'unknown native ownership cannot remove its private staging');
    } else { await first; assert.equal(database.open, false); }
    assert.equal(closes, 1, 'late methods, concurrent calls and failure cannot repeat original physical close');
  }
} finally { if (database?.open) originalClose.call(database); }
console.log(`SQLite writer ${selected} preserves original close, failure and finalization ownership.`);
