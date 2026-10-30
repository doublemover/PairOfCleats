import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildSqliteIndex } from '../../../../src/storage/sqlite/build/runner.js';
import { withSqliteStorageOperation } from '../../../../src/storage/sqlite/build/storage-operation.js';
import { resolveRepoCacheRootPath } from '../../../../src/shared/repo-paths.js';
import { resolveCacheTempRoot } from '../../../../src/shared/cache-roots.js';
import { inspectStorageAccess } from '../../../../src/shared/storage/access.js';
import { createBaseIndex, defaultUserConfig } from '../../../indexing/validate/helpers.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';
import { applyTestEnv } from '../../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('runner-finalizer-storage/')[1];
assert.ok(['wait', 'primary-and-finalizer', 'owned-child-in-finalizer'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`sqlite-finalizer-storage-${selected}`);
const root = path.join(dir, 'repo'), cache = path.join(dir, 'cache'), home = path.join(dir, 'home');
await fs.mkdir(root);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { ...defaultUserConfig, cache: { root: cache } }, repo = resolveRepoCacheRootPath(root, userConfig), tmp = resolveCacheTempRoot();
const source = await createBaseIndex({ rootDir: root, semantic: true });
const indexDir = path.join(repo, 'builds', 'generation', 'index-code');
await fs.cp(source.indexDir, indexDir, { recursive: true });
if (selected === 'primary-and-finalizer') {
  const file = path.join(indexDir, 'pieces', 'manifest.json'), manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...manifest, mode: 'prose' }));
}
const output = path.join(repo, 'builds', 'generation', 'index-sqlite', 'index-code.db');
const coordinationRoot = path.join(home, 'state', 'storage-access');
const protection = async expected => {
  for (const target of [cache, repo, tmp]) assert.equal((await inspectStorageAccess(target, { coordinationRoot })).protected, expected);
};
const contains = (value, expected, seen = new Set()) => {
  if (value === expected) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, expected, seen) || value instanceof AggregateError && value.errors.some(error => contains(error, expected, seen));
};
let release, announce, calls = 0, returned = false;
const entered = new Promise(resolve => { announce = resolve; }), gate = new Promise(resolve => { release = resolve; });
const cleanup = Object.freeze(new Error('original runner finalizer failed'));
await withSqliteStorageOperation({ repoRoot: root, userConfig }, [], () => {});
const before = process.listenerCount('exit');
const operation = buildSqliteIndex({ root, userConfig, mode: 'code', codeDir: indexDir, out: output, compact: false,
  emitOutput: false, validateMode: 'off', logger: { log() {}, warn() {}, error() {} },
  onFinalize: async () => {
    calls++; announce(); await protection(true);
    if (selected === 'primary-and-finalizer') throw cleanup;
    if (selected === 'owned-child-in-finalizer') {
      // A hook's accepted child must settle even if the hook ignores its Promise.
      void withSqliteStorageOperation(null, [output], async () => { await gate; });
    } else await gate;
  }
});
operation.finally(() => { returned = true; }).catch(() => {});
try {
  await entered;
  if (selected === 'primary-and-finalizer') {
    await assert.rejects(operation, error => error.code === 'ERR_SQLITE_SOURCE_MODE' && contains(error, cleanup),
      'finalizer failure cannot mask the source-admission failure');
  } else {
    await new Promise(resolve => setImmediate(resolve)); assert.equal(returned, false); await protection(true);
    release(); assert.equal((await operation).ok, true);
    const db = new Database(output, { readonly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS total FROM chunks').get().total, 1); } finally { db.close(); }
  }
  assert.equal(calls, 1); assert.equal(process.listenerCount('exit'), before); await protection(false);
} finally { release(); await operation.catch(() => {}); }
console.log(`Actual SQLite runner ${selected} awaits finalization and every accepted child before releasing launch categories.`);
