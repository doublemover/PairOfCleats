import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { open } from 'lmdb';
import { Packr } from 'msgpackr';
import { updateLmdbState } from '../../../src/storage/lmdb/index-state.js';
import { prepareLmdbReadyPublication } from '../../../src/storage/lmdb/ready-publication.js';
import { LMDB_ARTIFACT_KEYS, LMDB_SCHEMA_VERSION } from '../../../src/storage/lmdb/schema.js';
import { updateSqliteState } from '../../../src/storage/sqlite/build/index-state.js';
import { publishIndexStateMutation } from '../../../src/shared/index-state-publication.js';
import { runNativeDatabaseCommand } from '../../../tools/shared/native-database-lifetime.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual publication/mutex/native-command owners. Native cases
// use one tiny real LMDB store, never a full index or subprocess.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['positive', 'snapshot', 'concurrent-sqlite', 'source-change', 'native-change', 'embedding-change',
  'root-mismatch', 'invalid-request', 'commit-once', 'commit-failure-coalesced', 'native-success',
  'native-write-failure', 'native-close-failure', 'native-result-pending', 'mutation-revoked',
  'mutation-release-revoked', 'pending-request', 'source-observer-revoked', 'patch-observer-revoked'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`lmdb-ready-${selected}`);
const repoRoot = path.join(root, 'repo'), cache = path.join(root, 'cache'), home = path.join(root, 'home');
await fs.mkdir(repoRoot);
applyTestEnv({ cacheRoot: cache, extraEnv: { PAIROFCLEATS_HOME: home, PAIROFCLEATS_TRUSTED_CONFIG: null } });
const userConfig = { cache: { root: cache } }, repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
const indexDir = path.join(repoCacheRoot, 'builds', 'generation', 'index-code'), statePath = path.join(indexDir, 'index_state.json');
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(statePath, JSON.stringify({ mode: 'code', buildId: 'fixture-generation', sqlite: { keep: true }, extensions: { keep: 'source' } }));
const target = path.join(repoCacheRoot, 'builds', 'generation', 'index-lmdb', 'index-code');
const initial = await updateLmdbState(indexDir, { enabled: true, ready: false, pending: true, schemaVersion: LMDB_SCHEMA_VERSION });
const before = await fs.readFile(statePath, 'utf8'), read = async () => JSON.parse(await fs.readFile(statePath, 'utf8'));
const patch = { enabled: true, ready: true, pending: false, schemaVersion: LMDB_SCHEMA_VERSION, buildMode: 'code', path: target };
const lockPath = path.join(indexDir, '.index_state.write.lock');
let ready = selected !== 'pending-request', calls = 0, closes = 0, failure, database, actualClose, publication;
let denyManifest = selected === 'commit-failure-coalesced', passed = false, preserve = false;
const fault = Object.freeze(new Error('original LMDB ready-publication failure'));
const result = Object.freeze({ cacheOwnershipReleased() { assert.equal(this, result); return ready; } });
const originalOpen = fsSync.openSync, originalRm = fs.rm;
const sessions = new Set();
const retainSession = error => errorGraphSome(error, item => {
  if (item?.fileLockPublicationSession) sessions.add(item.fileLockPublicationSession);
  return false;
});
fsSync.openSync = (file, flags, ...args) => {
  if (typeof file === 'string' && typeof flags === 'string' && /[wax]/u.test(flags)) {
    if (denyManifest && path.dirname(file) === path.join(indexDir, 'pieces')) throw fault;
    if (selected === 'mutation-revoked' && path.dirname(file) === indexDir && file !== lockPath) ready = false;
  }
  return originalOpen(file, flags, ...args);
};
fs.rm = async (file, ...args) => {
  if (selected === 'mutation-release-revoked' && file === lockPath && ready) { ready = false; throw fault; }
  return originalRm(file, ...args);
};
try {
  if (selected === 'invalid-request') {
    for (const change of [{ ready: false }, { pending: true }, { schemaVersion: -1 }, { path: 'relative' }, { buildMode: 'records' }]) {
      await assert.rejects(prepareLmdbReadyPublication(indexDir, initial, { ...patch, ...change }));
    }
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (selected === 'root-mismatch') {
    const other = path.join(root, 'other'); await fs.mkdir(other);
    await assert.rejects(prepareLmdbReadyPublication(other, initial, patch), { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (selected === 'pending-request') {
    Object.defineProperty(patch, 'cacheOwnershipReleased', { value: result.cacheOwnershipReleased.bind(result) });
    await assert.rejects(prepareLmdbReadyPublication(indexDir, initial, patch));
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (selected.startsWith('mutation-')) {
    await assert.rejects(publishIndexStateMutation(indexDir, state => {
      state.lmdb.ready = true;
      Object.defineProperty(state, 'cacheOwnershipReleased', { value: result.cacheOwnershipReleased.bind(result) });
      return state;
    }), error => { failure = error; retainSession(error); return true; });
    assert.ok(sessions.size); assert.equal(failure.cacheOwnershipReleased(), false);
    ready = true; fs.rm = originalRm;
    for (const session of sessions) await session.releaseAfterClose();
    assert.equal(failure.cacheOwnershipReleased(), true);
  } else {
    if (selected === 'source-observer-revoked') Object.defineProperty(initial, 'cacheOwnershipReleased', { value: result.cacheOwnershipReleased.bind(result) });
    if (selected === 'patch-observer-revoked') Object.defineProperty(patch, 'cacheOwnershipReleased', { value: result.cacheOwnershipReleased.bind(result) });
    publication = await prepareLmdbReadyPublication(indexDir, initial, patch);
    assert.equal(await fs.readFile(statePath, 'utf8'), before, 'preparation cannot publish filesystem readiness');
    assert.equal(Object.isFrozen(publication.state.lmdb), true);
    if (selected === 'snapshot') {
      patch.path = path.join(root, 'unselected'); initial.buildId = 'caller-mutated';
      assert.throws(() => { publication.state.lmdb.ready = false; }, TypeError);
    }
    if (selected === 'concurrent-sqlite') await updateSqliteState(indexDir, { concurrent: 'preserved' });
    if (selected === 'source-change') await publishIndexStateMutation(indexDir, state => { state.buildId = 'new-generation'; });
    if (selected === 'native-change') await updateLmdbState(indexDir, { newerOwner: true });
    if (selected === 'embedding-change') await publishIndexStateMutation(indexDir, state => { state.embeddings = { invocationId: 'new-attempt' }; });
    if (selected.endsWith('observer-revoked')) ready = false;
    if (selected.startsWith('native-') && selected !== 'native-change') {
      const packr = new Packr();
      await assert.doesNotReject(async () => {
        try {
          await runNativeDatabaseCommand({ commandIdentity: 'lmdb.build' }, async resources => {
            resources.admitScope({ repoRoot, repoCacheRoot, userConfig, targets: [target] });
            database = open({ path: target, mapSize: 1024 * 1024 }); actualClose = database.close;
            database.close = function (done) {
              closes++; if (selected === 'native-close-failure') throw fault;
              const value = actualClose.call(this, done);
              return selected === 'native-result-pending' ? Promise.resolve(value).then(() => result) : value;
            };
            resources.own(database);
            await resources.use(database, db => {
              calls++; assert.equal(JSON.parse(fsSync.readFileSync(statePath, 'utf8')).lmdb.ready, false);
              db.putSync('retained-positive', 'indexed source');
              if (selected === 'native-write-failure') throw fault;
              db.putSync(LMDB_ARTIFACT_KEYS.indexState, packr.pack(publication.state));
              if (selected === 'native-result-pending') ready = false;
            });
            assert.equal(database.status, 'closed');
            await publication.commit();
          });
        } catch (error) { failure = error; }
      });
      assert.equal(closes, 1); assert.equal(calls, 1);
      if (selected === 'native-success') {
        assert.equal(failure, undefined);
        const reopened = open({ path: target, readOnly: true });
        try { assert.deepEqual(packr.unpack(reopened.get(LMDB_ARTIFACT_KEYS.indexState)), publication.state); }
        finally { await new Promise((resolve, reject) => { Promise.resolve(reopened.close(resolve)).catch(reject); }); }
      } else {
        assert.ok(failure); assert.equal(await fs.readFile(statePath, 'utf8'), before);
        if (selected !== 'native-result-pending') assert.equal(errorGraphIncludes(failure, fault), true);
        if (selected === 'native-result-pending') {
          ready = true; await failure.nativeDatabaseLifetime.recoverStorageMetadata();
          assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(closes, 1);
        }
        if (selected === 'native-close-failure') { preserve = true; assert.equal(failure.cacheOwnershipReleased(), false); }
      }
    } else if (['source-change', 'native-change', 'embedding-change'].includes(selected) || selected.endsWith('observer-revoked')) {
      const current = await fs.readFile(statePath, 'utf8');
      await assert.rejects(publication.commit(), error => { failure = error; retainSession(error); return true; });
      assert.equal(await fs.readFile(statePath, 'utf8'), current);
      if (selected.endsWith('observer-revoked')) {
        ready = true; for (const session of sessions) await session.releaseAfterClose();
      } else assert.equal(failure.code, 'ERR_INDEX_STATE_PUBLICATION_CONFLICT');
    } else if (selected === 'commit-failure-coalesced') {
      const first = publication.commit(); await assert.rejects(first, error => errorGraphIncludes(error, fault));
      denyManifest = false; assert.equal(publication.commit(), first); await assert.rejects(publication.commit());
    } else {
      const first = publication.commit(); assert.equal(publication.commit(), first); await first;
      const current = await read(); assert.equal(current.lmdb.ready, true); assert.equal(current.lmdb.pending, false);
      assert.equal(current.lmdb.path, target); assert.equal(current.buildId, 'fixture-generation');
      assert.equal(current.extensions.keep, 'source');
      if (selected === 'concurrent-sqlite') assert.equal(current.sqlite.concurrent, 'preserved');
      const manifest = JSON.parse(await fs.readFile(path.join(indexDir, 'pieces', 'manifest.json'), 'utf8'));
      const piece = manifest.pieces.find(item => item.name === 'index_state'), hash = await checksumFile(statePath);
      assert.equal(piece.checksum, `${hash.algo}:${hash.value}`); assert.equal(piece.bytes, (await fs.stat(statePath)).size);
    }
  }
  passed = true;
} finally {
  fsSync.openSync = originalOpen; fs.rm = originalRm; ready = true; denyManifest = false;
  for (const session of sessions) await session.releaseAfterClose();
  if (database?.status === 'open') await new Promise((resolve, reject) => { Promise.resolve(actualClose.call(database, resolve)).catch(reject); });
  if (passed && !preserve) {
    assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`));
    await fs.rm(root, { recursive: true, force: true });
  }
}
console.log(`LMDB ready publication follows original backend settlement: ${selected}`);
