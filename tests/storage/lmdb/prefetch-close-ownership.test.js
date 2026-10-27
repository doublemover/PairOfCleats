import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { open, allDbs } from 'lmdb';
import { Packr } from 'msgpackr';
import { createLmdbBackend } from '../../../src/retrieval/cli-lmdb.js';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';
import { LMDB_META_KEYS, LMDB_ARTIFACT_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import { buildLmdbReport } from '../../../src/index/validate/lmdb-report.js';
import { decodeLmdbValue } from '../../../src/storage/lmdb/utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectStorageAccess, withExclusiveStorageAccess } from '../../../src/shared/storage/access.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('prefetch-close-ownership/')[1];
assert.ok(['retrieval', 'builder', 'validator', 'retrieval-storage', 'builder-storage'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`lmdb-prefetch-close-${selected}`);
const storageCase = ['retrieval-storage', 'builder-storage'].includes(selected);
const home = path.join(dir, 'home'), cache = path.join(dir, 'cache'), repoRoot = path.join(dir, 'repo');
let storageContext = null, repoCacheRoot = null;
if (storageCase) {
  await fs.mkdir(repoRoot);
  applyTestEnv({ extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
  storageContext = { repoRoot, userConfig: { cache: { root: cache } } };
  repoCacheRoot = resolveRepoCacheRootPath(repoRoot, storageContext.userConfig);
}
const assertStorage = async expected => {
  if (!storageCase) return;
  const coordinationRoot = path.join(home, 'state', 'storage-access');
  for (const root of [cache, path.join(cache, 'repos'), repoCacheRoot, store]) {
    assert.equal((await inspectStorageAccess(root, { coordinationRoot })).protected, expected);
  }
};
const require = createRequire(import.meta.url);
const native = await import(pathToFileURL(path.join(path.dirname(require.resolve('lmdb')), '..', 'native.js')).href);
const addon = native.nativeAddon;
let announce, release, prefetchFailure;
const prefetched = new Promise(resolve => { announce = resolve; });
// Run the actual native prefetch. Hold only its callback handoff so the
// library's outstanding-read counter stays live at a deterministic boundary.
const intercepted = Object.create(addon);
Object.defineProperty(intercepted, 'prefetch', { value: (address, position, callback) => addon.prefetch(address, position, error => {
  prefetchFailure = error;
  release = () => callback(error);
  announce();
}) });
native.setNativeFunctions(intercepted);
const packr = new Packr(), store = storageCase
  ? path.join(repoCacheRoot, 'builds', 'generation', 'index-lmdb', 'index-code') : path.join(dir, 'store');
let database, disposal, returned = false, backendCleanup = null;
const originalSet = allDbs.set, setDescriptor = Object.getOwnPropertyDescriptor(allDbs, 'set');
try {
  const writer = open({ path: store, mapSize: 1024 * 1024 });
  try {
    writer.putSync(LMDB_META_KEYS.schemaVersion, packr.pack(LMDB_SCHEMA_VERSION));
    writer.putSync(LMDB_META_KEYS.mode, packr.pack('code'));
    for (const [key, value] of [[LMDB_META_KEYS.chunkCount, 0], [LMDB_META_KEYS.mapSizeBytes, 1024 * 1024],
      [LMDB_META_KEYS.mapSizeEstimatedBytes, 1024], [LMDB_META_KEYS.artifacts, [LMDB_ARTIFACT_KEYS.chunkMeta, LMDB_ARTIFACT_KEYS.tokenPostings]],
      [LMDB_ARTIFACT_KEYS.chunkMeta, []], [LMDB_ARTIFACT_KEYS.tokenPostings, { vocab: [], postings: [], docLengths: [] }]]) {
      writer.putSync(key, packr.pack(value));
    }
  } finally { await writer.close(); }
  if (selected === 'retrieval' || selected === 'retrieval-storage') {
    const backend = await createLmdbBackend({ useLmdb: true, needsCode: true, needsProse: false,
      lmdbCodePath: store, backendForcedLmdb: true, storageContext });
    backendCleanup = backend.dispose;
    database = backend.dbCode;
    await assertStorage(true);
    if (storageCase) assert.equal((await withExclusiveStorageAccess(cache,
      () => assert.fail('active LMDB readers prevent category relocation'),
      { coordinationRoot: path.join(home, 'state', 'storage-access') })).protected, true);
    database.prefetch([LMDB_META_KEYS.mode], () => {});
    await prefetched;
    disposal = backend.dispose();
    assert.equal(backend.dispose(), disposal, 'concurrent disposal joins its original owner');
  } else if (selected === 'builder' || selected === 'builder-storage') {
    disposal = runNativeDatabaseCommand({ commandIdentity: 'lmdb.build' }, async resources => {
      if (storageCase) resources.admitScope({ ...storageContext, repoCacheRoot, targets: [store] });
      database = resources.open(() => open({ path: store, readOnly: true }));
      database.prefetch([LMDB_META_KEYS.mode], () => {});
      await prefetched;
    });
    await prefetched;
  } else {
    allDbs.set = function (key, db) {
      const get = db.get;
      let started = false;
      db.get = function (name, ...args) {
        if (!started && name === LMDB_META_KEYS.schemaVersion) {
          started = true;
          this.prefetch([LMDB_META_KEYS.mode], () => {});
        }
        return get.call(this, name, ...args);
      };
      return originalSet.call(this, key, db);
    };
    disposal = buildLmdbReport({ root: dir, indexRoot: dir, userConfig: { lmdb: { codeDbPath: store } }, modes: ['code'], lmdbEnabled: true,
      report: { issues: [], warnings: [], hints: [] }, selection: { lmdbPaths: { code: store }, indexDirs: { code: dir } } });
    await prefetched;
    database = allDbs.get(path.basename(store));
  }
  disposal.then(() => { returned = true; }, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.ifError(prefetchFailure);
  assert.equal(database.status, 'closing');
  assert.equal(returned, false, 'neither owner may report closed while the actual prefetch callback remains outstanding');
  await assertStorage(true);
  release(); release = null;
  const outcome = await disposal;
  if (selected === 'validator') { assert.equal(outcome.ok, true); assert.deepEqual(outcome.warnings, []); }
  assert.equal(database.status, 'closed');
  await assertStorage(false);
  const reopened = open({ path: store, readOnly: true });
  try { assert.equal(decodeLmdbValue(reopened.get(LMDB_META_KEYS.mode)), 'code'); }
  finally { await reopened.close(); }
} finally {
  release?.();
  if (!disposal && backendCleanup) await backendCleanup().catch(() => {});
  if (disposal) await disposal.catch(() => {});
  // A pre-repair owner can return while native close is still finishing. Never
  // issue another close against that same environment during failure cleanup.
  if (database?.status === 'closing') {
    const deadline = Date.now() + 2000;
    while (database.status === 'closing' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(database.status, 'closed', 'the original native close must finish before the fixture exits');
  }
  native.setNativeFunctions(addon);
  if (setDescriptor) Object.defineProperty(allDbs, 'set', setDescriptor); else delete allDbs.set;
}
console.log(`Actual LMDB ${selected} disposal waits for its original native-prefetch completion.`);
