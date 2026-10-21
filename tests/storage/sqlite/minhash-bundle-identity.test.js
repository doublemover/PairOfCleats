import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { MINHASH_HASH_IDENTITY, SimpleMinHash } from '../../../src/index/minhash.js';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { incrementalUpdateDatabase } from '../../../src/storage/sqlite/build/incremental-update.js';
import { readSqliteMinhashHeader } from '../../../src/storage/sqlite/minhash.js';
import { createSqliteHelpers } from '../../../src/retrieval/sqlite-helpers.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('sqlite-minhash-bundle-identity');
const bundleDir = path.join(dir, 'bundles');
await fs.mkdir(bundleDir);
const outPath = path.join(dir, 'index-code.db');
const file = 'src/a.js';
const hash = new SimpleMinHash();
for (const token of ['alpha', 'beta']) hash.update(token);
const chunk = { file, start: 0, end: 1, tokens: ['alpha', 'beta'], minhashSig: hash.hashValues,
  minhashHashIdentity: MINHASH_HASH_IDENTITY };
const write = async (identity) => writeBundleFile({ bundlePath: path.join(bundleDir, 'a.json'),
  bundle: { chunks: [{ ...chunk, minhashHashIdentity: identity }] }, format: 'json' });
const manifest = revision => ({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  files: Object.fromEntries([file, 'src/b.js', 'src/c.js', 'src/d.js'].map((name, index) => [name,
    { hash: `revision-${index ? 1 : revision}`, mtimeMs: index ? 1 : revision, size: 1, bundles: [`${name[4]}.json`] }])) });
const options = revision => ({ Database, outPath, mode: 'code',
  incrementalData: { manifest: manifest(revision), bundleDir },
  envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 }, emitOutput: false,
  validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null } });
const snapshot = () => {
  const db = new Database(outPath);
  try {
    return { chunks: db.prepare('SELECT * FROM chunks ORDER BY id').all(),
      signatures: db.prepare('SELECT * FROM minhash_signatures ORDER BY doc_id').all(),
      manifest: db.prepare('SELECT * FROM file_manifest ORDER BY file').all(),
      header: db.prepare('SELECT * FROM minhash_meta ORDER BY mode').all() };
  } finally { db.close(); }
};
const assertCurrent = () => {
  const db = new Database(outPath);
  try {
    assert.equal(readSqliteMinhashHeader(db, 'code').hashIdentity, MINHASH_HASH_IDENTITY);
    const idx = createSqliteHelpers({ getDb: () => db, postingsConfig: {} }).loadIndexFromSqlite('code',
      { includeChunks: false, includeDense: false, includeFilterIndex: false });
    assert.equal(rankMinhash(idx, chunk.tokens, 1)[0]?.sim, 1);
  } finally { db.close(); }
};
for (const name of ['b', 'c', 'd']) {
  await writeBundleFile({ bundlePath: path.join(bundleDir, `${name}.json`),
    bundle: { chunks: [{ ...chunk, file: `src/${name}.js` }] }, format: 'json' });
}
await write(MINHASH_HASH_IDENTITY);
await buildDatabaseFromBundles(options(1));
assertCurrent();
const fresh = snapshot();
for (const identity of [undefined, 'legacy-polynomial-v1']) {
  await write(identity);
  // The caller owns full-build staging; the low-level builder owns its disposable output.
  const failed = await buildDatabaseFromBundles({ ...options(2), outPath: path.join(dir, 'rejected-stage.db') });
  assert.equal(failed.count, 0, 'failed full build retains the existing structured failure contract');
  assert.match(failed.reason, /MinHash hash identity.*rebuild the index/);
  assert.deepEqual(snapshot(), fresh, 'failed staged full build preserves the published database');
  await assert.rejects(incrementalUpdateDatabase(options(2)), { code: 'ERR_ARTIFACT_INVALID' });
  assert.deepEqual(snapshot(), fresh, 'invalid new bundle rolls back deletes and dependent writes');
}
await write(MINHASH_HASH_IDENTITY);
const old = new Database(outPath);
old.prepare('UPDATE minhash_meta SET hash_identity = ?').run('legacy-polynomial-v1');
old.close();
const stale = snapshot();
await assert.rejects(incrementalUpdateDatabase(options(1)), { code: 'ERR_ARTIFACT_INVALID' });
assert.deepEqual(snapshot(), stale, 'even the unchanged warm path must reject stale hash authority');
await assert.rejects(incrementalUpdateDatabase(options(2)), { code: 'ERR_ARTIFACT_INVALID' });
assert.deepEqual(snapshot(), stale, 'unknown retained signatures cannot be relabelled by an incremental update');
await buildDatabaseFromBundles(options(2));
assertCurrent();
assert.equal((await incrementalUpdateDatabase(options(3))).used, true);
assertCurrent();
const warm = await incrementalUpdateDatabase(options(3));
assert.equal(warm.used, true);
assert.equal(warm.insertedChunks, 0, 'unchanged warm update is still a no-op');
console.log('MinHash bundle identity passed: staged rebuild, rollback, stale receiver and warm incremental admission');
