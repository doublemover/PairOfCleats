import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { open } from 'lmdb';
import { Packr } from 'msgpackr';
import { createLmdbBackend } from '../../../src/retrieval/cli-lmdb.js';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';
import { LMDB_META_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import { decodeLmdbValue } from '../../../src/storage/lmdb/utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('prefetch-close-ownership/')[1];
assert.ok(['retrieval', 'builder'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`lmdb-prefetch-close-${selected}`);
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
const packr = new Packr(), store = path.join(dir, 'store');
let database, disposal, returned = false;
try {
  const writer = open({ path: store, mapSize: 1024 * 1024 });
  try {
    writer.putSync(LMDB_META_KEYS.schemaVersion, packr.pack(LMDB_SCHEMA_VERSION));
    writer.putSync(LMDB_META_KEYS.mode, packr.pack('code'));
  } finally { await writer.close(); }
  if (selected === 'retrieval') {
    const backend = await createLmdbBackend({ useLmdb: true, needsCode: true, needsProse: false,
      lmdbCodePath: store, backendForcedLmdb: true });
    database = backend.dbCode;
    database.prefetch([LMDB_META_KEYS.mode], () => {});
    await prefetched;
    disposal = backend.dispose();
    assert.equal(backend.dispose(), disposal, 'concurrent disposal joins its original owner');
  } else {
    disposal = runNativeDatabaseCommand({ commandIdentity: 'lmdb.build' }, async resources => {
      database = resources.open(() => open({ path: store, readOnly: true }));
      database.prefetch([LMDB_META_KEYS.mode], () => {});
      await prefetched;
    });
    await prefetched;
  }
  disposal.then(() => { returned = true; }, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.ifError(prefetchFailure);
  assert.equal(database.status, 'closing');
  assert.equal(returned, false, 'neither owner may report closed while the actual prefetch callback remains outstanding');
  release(); release = null;
  await disposal;
  assert.equal(database.status, 'closed');
  const reopened = open({ path: store, readOnly: true });
  try { assert.equal(decodeLmdbValue(reopened.get(LMDB_META_KEYS.mode)), 'code'); }
  finally { await reopened.close(); }
} finally {
  release?.();
  if (disposal) await disposal.catch(() => {});
  // A pre-repair owner can return while native close is still finishing. Never
  // issue another close against that same environment during failure cleanup.
  if (database?.status === 'closing') {
    const deadline = Date.now() + 2000;
    while (database.status === 'closing' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(database.status, 'closed', 'the original native close must finish before the fixture exits');
  }
  native.setNativeFunctions(addon);
}
console.log(`Actual LMDB ${selected} disposal waits for its original native-prefetch completion.`);
