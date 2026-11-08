import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { checksumFile } from '../../src/shared/hash.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { errorGraphIncludes, errorGraphSome } from '../helpers/error-graph.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { getContainedFileSession } from '../../src/shared/contained-file.js';

// UNVALIDATED: actual state/manifest producers and real healthy writes. The
// original writer boundary injects one frozen failure, without a database/model.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['sqlite-write', 'lmdb-write', 'sqlite-read', 'lmdb-read', 'sqlite-invalid', 'lmdb-invalid',
  'manifest-read', 'manifest-write', 'manifest-checksum', 'manifest-size-race', 'healthy-sqlite', 'healthy-lmdb'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'native-state-'));
const statePath = path.join(root, 'index_state.json'), manifestPath = path.join(root, 'pieces', 'manifest.json');
const initial = { mode: 'code', generatedAt: '2026-10-28T00:00:00.000Z', extensions: { caller: { keep: true } },
  lmdb: { preserved: 'lmdb' }, sqlite: { preserved: 'sqlite' } };
const manifest = { version: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [{ name: 'index_state', path: 'index_state.json', bytes: 0, checksum: 'stale' },
    { name: 'other', path: 'other.json', bytes: 2, checksum: 'unrelated' }], extensions: { caller: { keep: true } } };
let settled = false;
const original = Object.freeze(Object.assign(new Error('Original required publication remains outstanding.'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, original); return settled; }
}));
globalThis.__nativeStatePublicationFault = file => {
  if (['sqlite-write', 'lmdb-write'].includes(selected) && path.resolve(file) === statePath
    || selected === 'manifest-write' && path.resolve(file) === manifestPath) throw original;
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/json-stream/json-writers.js')) {
    const actual = JSON.stringify(url + '?native-state-original');
    return { format: 'module', shortCircuit: true, source: `export * from ${actual};
      import {writeJsonObjectFile as actual} from ${actual};
      export const writeJsonObjectFile=(file,options)=>{globalThis.__nativeStatePublicationFault(file);return actual(file,options);};` };
  }
  return next(url, context);
} });
const stat = fs.stat;
const open = fs.open;
try {
  await fs.mkdir(path.dirname(manifestPath));
  await fs.writeFile(statePath, selected.endsWith('-read') && selected !== 'manifest-read' ? '{truncated' : selected.endsWith('-invalid') ? 'null' : JSON.stringify(initial));
  await fs.writeFile(manifestPath, selected === 'manifest-read' ? '{truncated' : JSON.stringify(manifest));
  const stateBefore = await fs.readFile(statePath, 'utf8'), manifestBefore = await fs.readFile(manifestPath, 'utf8');
  const { updateSqliteState } = await import('../../src/storage/sqlite/build/index-state.js');
  const { updateLmdbState } = await import('../../src/storage/lmdb/index-state.js');
  const { updateIndexStateManifest } = await import('../../src/shared/index-state-utils.js');
  if (selected === 'manifest-checksum') fs.open = async (file, ...args) => {
    const handle = await open(file, ...args);
    if (path.resolve(file) === statePath) handle.stat = async () => { throw original; };
    return handle;
  };
  if (selected === 'manifest-size-race') fs.stat = async (file, ...args) => {
    const result = await stat(file, ...args);
    if (path.resolve(file) === statePath) await fs.appendFile(statePath, ' ');
    return result;
  };
  const run = () => selected.startsWith('manifest-') ? updateIndexStateManifest(root)
    : selected.includes('lmdb') ? updateLmdbState(root, { ready: true }) : updateSqliteState(root, { status: 'ready' });
  if (selected.startsWith('healthy-') || selected === 'manifest-size-race') {
    await run();
    fs.stat = stat;
    const state = JSON.parse(await fs.readFile(statePath, 'utf8')), result = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(state.lmdb.preserved, 'lmdb'); assert.equal(state.sqlite.preserved, 'sqlite');
    assert.deepEqual(state.extensions.caller, initial.extensions.caller); assert.deepEqual(result.extensions.caller, manifest.extensions.caller);
    assert.deepEqual(result.pieces[1], manifest.pieces[1]);
    const checksum = await checksumFile(statePath);
    assert.equal(result.pieces[0].bytes, (await fs.stat(statePath)).size);
    assert.equal(result.pieces[0].checksum, `${checksum.algo}:${checksum.value}`);
    if (selected === 'healthy-lmdb') assert.equal(state.lmdb.ready, true);
    else if (selected === 'healthy-sqlite') assert.equal(state.sqlite.status, 'ready');
  } else {
    let failure;
    await assert.rejects(run(), error => { failure = error; return true; });
    if (selected.endsWith('-write') || selected === 'manifest-checksum') {
      assert.equal(errorGraphIncludes(failure, original), true); assert.equal(failure.cacheOwnershipReleased(), false);
      settled = true;
      if (selected === 'sqlite-write' || selected === 'lmdb-write') {
        assert.equal(failure.cacheOwnershipReleased(), false, 'original writer settlement alone cannot retire publication metadata');
        let publication;
        errorGraphSome(failure, error => { publication = error?.fileLockPublicationSession; return Boolean(publication); });
        assert.ok(publication); await publication.releaseAfterClose();
      }
      if (selected === 'manifest-checksum') {
        let owner;
        errorGraphSome(failure, error => { owner = getContainedFileSession(error); return Boolean(owner); });
        assert.ok(owner, 'a pending descriptor-stat failure retains the exact checksum reader');
        await owner.releaseAfterClose();
      }
      assert.equal(failure.cacheOwnershipReleased(), true);
    }
    if (selected.endsWith('-invalid')) assert.equal(failure.code, 'ERR_INDEX_STATE_INVALID');
    assert.equal(await fs.readFile(statePath, 'utf8'), stateBefore, 'a failed read/write/manifest-only refresh cannot replace source state');
    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifestBefore, 'failed publication cannot claim a new manifest');
  }
} finally {
  settled = true; fs.stat = stat; fs.open = open; hook.deregister(); delete globalThis.__nativeStatePublicationFault;
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Required native index-state publication: ${selected}`);
