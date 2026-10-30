import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildSqliteIndex } from '../../../src/integrations/core/build-index/sqlite.js';
import { createBaseIndex, defaultUserConfig } from '../../indexing/validate/helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-probe-staging');
const root = path.join(dir, 'repo'), cache = path.join(dir, 'cache');
await fs.mkdir(root);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
const source = await createBaseIndex({ rootDir: root, semantic: true });
const userConfig = { ...defaultUserConfig, cache: { root: cache } }, out = path.join(dir, 'output.db');
const originalPrepare = Database.prototype.prepare, originalClose = Database.prototype.close, originalRm = fs.rm;
let captured = null, stage = null, closes = 0, removed = 0, independentSettled = false;
const primary = Object.freeze(Object.assign(new Error('original post-import probe work remains pending'), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => independentSettled
}));
Database.prototype.prepare = function (sql, ...args) {
  if (this.readonly && sql === 'SELECT COUNT(*) AS total FROM chunks WHERE mode = ?') {
    assert.equal(captured, null, 'the first native post-import probe stops further admission');
    captured = this; stage = this.name; throw primary;
  }
  return originalPrepare.call(this, sql, ...args);
};
Database.prototype.close = function () { if (this === captured) closes++; return originalClose.call(this); };
fs.rm = async (target, ...args) => {
  if (stage && [stage, `${stage}-wal`, `${stage}-shm`].includes(target)) removed++;
  return originalRm(target, ...args);
};
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen));
};
try {
  await assert.rejects(buildSqliteIndex(root, { userConfig, mode: 'code', codeDir: source.indexDir,
    out, emitOutput: false, validateMode: 'off', logger: { log() {}, warn() {}, error() {} } }), error => contains(error, primary));
  assert.ok(stage); assert.notEqual(stage, out);
  assert.equal(closes, 1); assert.equal(captured.open, false, 'the physical probe handle closed but independent work remains unconfirmed');
  assert.equal(removed, 0, 'the actual runner cannot delete staged database or sidecars after pending probe ownership');
  assert.ok((await fs.stat(stage)).size > 0, 'unpublished staged native evidence survives the rejected build');
  assert.equal(await fs.stat(out).then(() => true, error => { assert.equal(error.code, 'ENOENT'); return false; }), false);
  assert.equal(primary.exitCode, undefined, 'frozen original failure is not mutated during classification');
} finally {
  Database.prototype.prepare = originalPrepare; Database.prototype.close = originalClose; fs.rm = originalRm;
  independentSettled = true;
  if (captured?.open) originalClose.call(captured);
}
console.log('Actual SQLite build preserves staged native evidence when a post-import probe retains independent work.');
