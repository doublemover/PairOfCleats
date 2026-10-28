import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { captureInitialIndexStatePublication, runInitialIndexStatePublication } from '../../../src/index/build/artifacts/index-state-publication.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { readStableIndexStateHash } from '../../../src/index/build/artifacts/write-runtime-helpers.js';
import { updateSqliteState } from '../../../src/storage/sqlite/build/index-state.js';
import { withIndexStatePublicationLock } from '../../../src/shared/index-state-publication.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual initial-state sessions, atomic JSON/manifest writers,
// native namespace publication and reuse readers. No native database or link.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['initial-write', 'stale-before-state', 'stale-before-manifest', 'native-change', 'wrong-session',
  'wrong-directory', 'pending-result', 'observed-extent', 'null-sealed-bytes', 'invalid-sealed-bytes',
  'pending-stat', 'pending-hash', 'sealed-state-refresh', 'request-snapshot', 'reuse-hash-pending',
  'registry-null', 'registry-invalid'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'initial-state-publication-'));
const statePath = path.join(root, 'index_state.json'), payloadPath = path.join(root, 'chunk_meta.json');
const manifestPath = path.join(root, 'pieces', 'manifest.json');
const initial = { mode: 'code', generatedAt: '2026-10-28T00:00:00.000Z', buildId: 'original-build', keep: 1 };
const entry = { name: 'chunk_meta', type: 'chunk-meta', format: 'json', path: 'chunk_meta.json' };
const stat = fs.stat, open = fs.open, syncOpen = fsSync.openSync, readFile = fsSync.readFileSync;
let inject = false, settled = false, failure, release, held;
const pending = Object.freeze(Object.assign(new Error('original initial-publication work remains outstanding'), {
  cacheOwnershipReleased() { assert.equal(this, pending); return settled; }
}));
fs.stat = async (file, ...args) => {
  if (inject && path.resolve(file) === payloadPath && selected === 'pending-stat') throw pending;
  const result = await stat(file, ...args);
  return inject && path.resolve(file) === payloadPath && selected === 'observed-extent'
    ? new Proxy(result, { get(target, key) { return key === 'size' ? 999 : Reflect.get(target, key); } }) : result;
};
fs.open = async (file, ...args) => {
  if (inject && path.resolve(file) === payloadPath && selected === 'pending-hash') throw pending;
  return open(file, ...args);
};
fsSync.readFileSync = (file, ...args) => {
  if (inject && typeof file === 'string' && path.resolve(file) === statePath && selected === 'reuse-hash-pending') throw pending;
  return readFile(file, ...args);
};
const publish = options => writePiecesManifest({ outDir: root, mode: 'code', indexState: initial, pieceEntries: [entry], ...options });
const captureFailure = async action => assert.rejects(action, error => { failure = error; return true; });
try {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(initial)); await fs.writeFile(payloadPath, '[]\n');
  await fs.writeFile(manifestPath, JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'index_state', type: 'stats', format: 'json', path: 'index_state.json' }] }));
  const session = captureInitialIndexStatePublication(root), before = await fs.readFile(statePath, 'utf8');
  if (selected === 'initial-write') {
    const next = { ...initial, stage: 'stage2', keep: 2 };
    await runInitialIndexStatePublication(session, root, () => writeJsonObjectFile(statePath, { fields: next, atomic: true }));
    await publish({ indexStatePublication: session });
    assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')), next);
  } else if (['stale-before-state', 'stale-before-manifest', 'native-change'].includes(selected)) {
    if (selected === 'stale-before-manifest') await runInitialIndexStatePublication(session, root,
      () => writeJsonObjectFile(statePath, { fields: { ...initial, keep: 2 }, atomic: true }));
    if (selected === 'native-change') await updateSqliteState(root, { ready: true, actual: 9 });
    else await fs.writeFile(statePath, JSON.stringify({ ...initial, keep: 3 }));
    const current = await fs.readFile(statePath, 'utf8'), manifest = await fs.readFile(manifestPath, 'utf8');
    let calls = 0;
    await assert.rejects(selected === 'stale-before-state'
      ? runInitialIndexStatePublication(session, root, () => { calls++; })
      : publish({ indexStatePublication: session }), { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
    assert.equal(calls, 0); assert.equal(await fs.readFile(statePath, 'utf8'), current);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), manifest);
  } else if (selected === 'wrong-session' || selected === 'wrong-directory') {
    const other = path.join(root, 'other'); await fs.mkdir(other);
    let calls = 0;
    await assert.rejects(runInitialIndexStatePublication(selected === 'wrong-session' ? {} : session,
      selected === 'wrong-directory' ? other : root, () => { calls++; }), { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
    assert.equal(calls, 0); assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (selected === 'pending-result') {
    let calls = 0;
    await captureFailure(runInitialIndexStatePublication(session, root, () => { calls++; return pending; }));
    assert.equal(calls, 1); assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (['observed-extent', 'null-sealed-bytes'].includes(selected)) {
    inject = true; await publish({ pieceEntries: [{ ...entry, bytes: null }] }); inject = false;
    const piece = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces[0], checksum = await checksumFile(payloadPath);
    assert.equal(piece.bytes, 3); assert.equal(piece.checksum, `${checksum.algo}:${checksum.value}`);
  } else if (selected === 'invalid-sealed-bytes') {
    for (const bytes of ['3', -1, false, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(publish({ pieceEntries: [{ ...entry, bytes }] }), /invalid sealed size/u);
  } else if (['pending-stat', 'pending-hash'].includes(selected)) {
    inject = true; await captureFailure(publish()); inject = false;
  } else if (selected === 'sealed-state-refresh') {
    const count = (await fs.stat(statePath)).size;
    await fs.writeFile(statePath, JSON.stringify({ ...initial, keep: 2 }));
    await publish({ pieceEntries: [{ name: 'index_state', path: 'index_state.json', type: 'stats', format: 'json',
      bytes: count, checksum: 'xxh64:0000000000000000' }] });
    const piece = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces[0], checksum = await checksumFile(statePath);
    assert.equal(piece.checksum, `${checksum.algo}:${checksum.value}`); assert.notEqual(piece.checksum, 'xxh64:0000000000000000');
  } else if (selected === 'request-snapshot') {
    let entered; const acquired = new Promise(resolve => { entered = resolve; });
    held = withIndexStatePublicationLock(root, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
    await acquired;
    const entries = [{ ...entry }], publication = publish({ pieceEntries: entries });
    entries[0].path = 'unpublished-change.json'; release(); await held; await publication;
    assert.equal(JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces[0].path, entry.path);
  } else if (selected === 'reuse-hash-pending') {
    inject = true; await captureFailure(readStableIndexStateHash(statePath, { maxBytes: 1024 * 1024 })); inject = false;
  } else {
    const registry = createArtifactPieceRegistry({ outDir: root }); registry.addPieceFile(entry, payloadPath);
    if (selected === 'registry-null') { registry.updatePieceMetadata(entry.path, { bytes: null }); assert.equal(registry.listPieceEntries()[0].bytes, undefined); }
    else for (const bytes of ['3', -1, false, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => registry.updatePieceMetadata(entry.path, { bytes }), /Invalid sealed artifact/u);
    registry.updatePieceMetadata(entry.path, { bytes: 0 }); assert.equal(registry.listPieceEntries()[0].bytes, 0, 'observed zero stays zero');
  }
  if (failure) {
    assert.equal(errorGraphIncludes(failure, pending), true); assert.equal(failure.cacheOwnershipReleased(), false);
    if (selected !== 'reuse-hash-pending') {
      let session; errorGraphSome(failure, value => { session = value?.fileLockPublicationSession; return Boolean(session); });
      assert.ok(session); settled = true; await session.releaseAfterClose(); assert.equal(failure.cacheOwnershipReleased(), true);
    } else { settled = true; assert.equal(failure.cacheOwnershipReleased(), true); }
  }
  await assert.rejects(fs.stat(path.join(root, '.index_state.write.lock')), { code: 'ENOENT' });
} finally {
  inject = false; settled = true; release?.(); if (held) await held;
  fs.stat = stat; fs.open = open; fsSync.openSync = syncOpen; fsSync.readFileSync = readFile;
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Initial state publication: ${selected}`);
