import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSqliteBenchWorkspace, createSqliteBenchBundleFixture } from '../../../../tools/bench/sqlite/shared.js';
import { prepareSqliteBenchValidation, validateSqliteBenchDatabase } from '../../../../tools/bench/sqlite/validate.js';
import { buildDatabaseFromBundles } from '../../../../src/storage/sqlite/build/from-bundles.js';
import { getSqliteCacheFailureOwner } from '../../../../src/retrieval/sqlite-cache-close-owner.js';
import { observeStorageResource } from '../../../../src/shared/storage/failure-observation.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
applyTestEnv();
const workspace = await createSqliteBenchWorkspace({ name: 'sqlite-admitted-validation-control' });
let pendingOwner = null, permitOriginalClose = false, primary;
try {
  const { manifest } = await createSqliteBenchBundleFixture({ bundleDir: workspace.bundleDir, fileCount: 4, chunksPerFile: 2 });
  const admission = await prepareSqliteBenchValidation({ bundleDir: workspace.bundleDir, manifest });
  assert.equal(admission.rows, 8); assert.equal(admission.files, 4); assert.ok(admission.bundleBytes > admission.sourceBytes);
  const dbPath = path.join(workspace.workRoot, 'actual.db');
  const built = await buildDatabaseFromBundles({ Database, outPath: dbPath, mode: 'code', emitOutput: false,
    incrementalData: { bundleDir: workspace.bundleDir, manifest }, vectorConfig: { enabled: false }, validateMode: 'off' });
  assert.equal(built.count, 8);
  const valid = await validateSqliteBenchDatabase({ Database, dbPath, bundleDir: workspace.bundleDir, manifest, mode: 'code', expectedRows: 8, admission });
  assert.equal(valid.chunks, 8); assert.equal(valid.postings, 16); assert.equal(valid.inputAdmission, admission);
  let opens = 0;
  class MustNotOpen { constructor() { opens++; throw new Error('unadmitted source opened a database'); } }
  await assert.rejects(validateSqliteBenchDatabase({ Database: MustNotOpen, dbPath, bundleDir: workspace.bundleDir,
    manifest, mode: 'code', admission: structuredClone(admission) }), /source capability/u);
  const changed = structuredClone(manifest); changed.files['src/file-0.js'].size++;
  await assert.rejects(validateSqliteBenchDatabase({ Database: MustNotOpen, dbPath, bundleDir: workspace.bundleDir,
    manifest: changed, mode: 'code', admission }), /source capability/u);
  assert.equal(opens, 0);
  const first = path.join(workspace.bundleDir, manifest.files['src/file-0.js'].bundles[0]), bytes = await fs.readFile(first);
  await fs.writeFile(first, '{}');
  await assert.rejects(prepareSqliteBenchValidation({ bundleDir: workspace.bundleDir, manifest }), /source snapshot must admit/u);
  const captured = await validateSqliteBenchDatabase({ Database, dbPath, bundleDir: workspace.bundleDir, manifest, mode: 'code', admission });
  assert.equal(captured.stableContentSha256, valid.stableContentSha256, 'explicit admitted facts retain the earlier source observation, not current-file authority');
  await fs.writeFile(first, bytes);
  const originalQuery = Object.freeze(new Error('original validation query failure')), originalClose = Object.freeze(new Error('original native close failure'));
  const contains = (error, target, seen = new Set()) => {
    if (error === target) return true;
    if (!error || typeof error !== 'object' || seen.has(error)) return false;
    seen.add(error); return contains(error.cause, target, seen) || (error.errors || []).some(child => contains(child, target, seen));
  };
  const findOwner = (error, seen = new Set()) => {
    if (!error || typeof error !== 'object' || seen.has(error)) return null;
    seen.add(error); return getSqliteCacheFailureOwner(error) || findOwner(error.cause, seen)
      || (error.errors || []).map(child => findOwner(child, seen)).find(Boolean) || null;
  };
  function NativeBoundary(...args) {
    const db = new Database(...args), close = db.close;
    db.prepare = () => { throw originalQuery; };
    db.close = function() { if (!permitOriginalClose) throw originalClose; return close.call(this); };
    return db;
  }
  await assert.rejects(validateSqliteBenchDatabase({ Database: NativeBoundary, dbPath, bundleDir: workspace.bundleDir,
    manifest, mode: 'code', admission }), error => {
    pendingOwner = findOwner(error); assert.ok(pendingOwner);
    assert.ok(contains(error, originalQuery)); assert.ok(contains(error, originalClose));
    assert.equal(observeStorageResource(error).isSettled(), false); return true;
  });
  permitOriginalClose = true; pendingOwner.release(); assert.equal(pendingOwner.isSettled(), true);
} catch (error) { primary = error; throw error; }
finally {
  if (pendingOwner && !pendingOwner.isSettled()) { permitOriginalClose = true; pendingOwner.release(); }
  if (primary !== undefined) observeStorageResource(primary).requireSettled();
  await workspace.workOwner.reclaim();
}
console.log('Actual SQLite validation binds admitted immutable source facts and preserves original query/close failures through the original native owner.');
