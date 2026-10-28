import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { updatePieceManifest } from '../../../tools/build/embeddings/manifest.js';
import { loadIndexState, writeIndexState } from '../../../tools/build/embeddings/state.js';
import { publishEmbeddingGeneration } from '../../../tools/build/embeddings/publication.js';
import { withIndexStatePublicationLock } from '../../../src/shared/index-state-publication.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { updateSqliteState } from '../../../src/storage/sqlite/build/index-state.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes, errorGraphSome } from '../../helpers/error-graph.js';

// UNVALIDATED: actual publication and native-state owners, real files, original
// I/O fault boundaries. No native decoder/model or physical link is required.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['metadata-valid', 'metadata-zero', 'metadata-null', 'string-count', 'negative-count', 'unsafe-count',
  'malformed-meta', 'unreadable-meta', 'pending-meta', 'unselected-meta', 'missing-meta',
  'state-hash-failure', 'vector-hash-failure', 'observed-extent', 'concurrent-state', 'queued-snapshot',
  'stale-attempt', 'validation-stale-attempt', 'unmarked-primary-read', 'primary-backup',
  'pending-binary-meta', 'malformed-shards', 'receipt-lock', 'validation-pending', 'receipt-pending',
  'receipt-revokes-validation', 'validation-getter'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'embedding-manifest-owner-'));
const manifestPath = path.join(root, 'pieces', 'manifest.json'), statePath = path.join(root, 'index_state.json');
const metaPath = path.join(root, 'dense_vectors_hnsw.meta.json'), binaryPath = path.join(root, 'dense_vectors_uint8.bin');
const binaryMetaPath = binaryPath + '.meta.json';
const originalOpen = fsSync.openSync, originalAsyncOpen = fs.open, originalStat = fs.stat;
let faultPath = null, asyncFaultPath = null, injectExtent = false, settled = false, failure, release, held;
const ordinary = Object.freeze(Object.assign(new Error('original publication read failed'), { code: 'EACCES' }));
// No marker: an original unconfirmed observer still blocks backup/fallback.
const pending = Object.freeze(Object.assign(new Error('original read remains outstanding'), {
  cacheOwnershipReleased() { assert.equal(this, pending); return settled; }
}));
const pendingFault = ['pending-meta', 'pending-binary-meta', 'unmarked-primary-read', 'validation-pending', 'receipt-pending'].includes(selected);
fsSync.openSync = (file, ...args) => {
  if (typeof file === 'string' && path.resolve(file) === faultPath) throw pendingFault ? pending : ordinary;
  return originalOpen(file, ...args);
};
fs.open = async (file, ...args) => {
  if (typeof file === 'string' && path.resolve(file) === asyncFaultPath) throw ordinary;
  return originalAsyncOpen(file, ...args);
};
fs.stat = async (file, ...args) => {
  const stat = await originalStat(file, ...args);
  if (injectExtent && path.resolve(file) === binaryPath) return new Proxy(stat, {
    get(target, key) { return key === 'size' ? 999 : Reflect.get(target, key); }
  });
  return stat;
};
const publish = options => updatePieceManifest({ indexDir: root, mode: 'code', totalChunks: 3, dims: 4, ...options });
const hold = async () => {
  let entered; const acquired = new Promise(resolve => { entered = resolve; });
  held = withIndexStatePublicationLock(root, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await acquired;
};
const claim = async id => {
  const state = loadIndexState(statePath); state.extensions = { ...state.extensions, runtimeAttemptId: id };
  await writeIndexState(statePath, state, { attemptId: id, claimAttempt: true }); return state;
};
try {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify({ mode: 'code', generatedAt: '2026-10-28T00:00:00.000Z',
    buildId: 'original-generation', embeddings: { ready: false, pending: true } }));
  await fs.writeFile(manifestPath, JSON.stringify({ version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'index_state', type: 'stats', format: 'json', path: 'index_state.json' },
      { name: 'unrelated', path: 'unrelated.json', bytes: 2, checksum: 'retained' }] }));
  const before = await fs.readFile(manifestPath, 'utf8');
  if (selected.startsWith('metadata-') || ['string-count', 'negative-count', 'unsafe-count', 'malformed-meta',
    'unreadable-meta', 'pending-meta', 'unselected-meta'].includes(selected)) {
    const meta = { dims: 4, count: selected === 'metadata-zero' ? 0 : 2, space: 'cosine', m: 16, efConstruction: 100, efSearch: 64 };
    if (selected === 'string-count') meta.count = '2';
    if (selected === 'negative-count') meta.count = -1;
    if (selected === 'unsafe-count') meta.count = Number.MAX_SAFE_INTEGER + 1;
    await fs.writeFile(metaPath, selected === 'metadata-null' ? 'null' : ['malformed-meta', 'unselected-meta'].includes(selected) ? '{truncated' : JSON.stringify(meta));
    await fs.writeFile(path.join(root, 'dense_vectors_hnsw.bin'), 'closed-fixture-native-bytes');
    if (['unreadable-meta', 'pending-meta'].includes(selected)) faultPath = metaPath;
    if (['metadata-valid', 'metadata-zero', 'unselected-meta'].includes(selected)) {
      await publish(selected === 'unselected-meta' ? { backendPieces: [] } : {});
      const pieces = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces;
      const piece = pieces.find(item => item.name === 'dense_vectors_hnsw');
      if (selected === 'unselected-meta') assert.equal(piece, undefined);
      else { assert.equal(piece.count, meta.count); assert.equal(piece.dims, 4); }
    } else await assert.rejects(publish(), error => { failure = error; return true; });
  } else if (selected === 'missing-meta') {
    await fs.writeFile(path.join(root, 'dense_vectors_hnsw.bin'), 'legacy-native-bytes');
    await publish();
    const piece = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces.find(item => item.name === 'dense_vectors_hnsw');
    assert.equal(piece.count, 3); assert.equal(piece.dims, 4);
  } else if (['state-hash-failure', 'vector-hash-failure', 'observed-extent'].includes(selected)) {
    await fs.writeFile(binaryPath, Buffer.from([1, 2, 3, 4]));
    if (selected === 'observed-extent') {
      injectExtent = true; await publish(); injectExtent = false;
      const piece = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces.find(item => item.name === 'dense_vectors');
      const checksum = await checksumFile(binaryPath);
      assert.equal(piece.bytes, 4); assert.equal(piece.checksum, `${checksum.algo}:${checksum.value}`);
    } else {
      asyncFaultPath = selected === 'state-hash-failure' ? statePath : binaryPath;
      await assert.rejects(publish(), error => { failure = error; return errorGraphIncludes(error, ordinary); });
    }
  } else if (['concurrent-state', 'queued-snapshot'].includes(selected)) {
    await fs.writeFile(path.join(root, 'fixture-native.bin'), 'fixture-native-bytes');
    const pieces = [{ type: 'embeddings', name: 'dense_vectors_hnsw', format: 'bin', path: 'fixture-native.bin', count: 2, dims: 4 }];
    await hold();
    const publication = publish({ backendPieces: pieces });
    pieces[0].path = 'later-unpublished-request.bin';
    const native = selected === 'concurrent-state' ? updateSqliteState(root, { ready: true, count: 9 }) : Promise.resolve();
    release(); await held; await Promise.all([publication, native]);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.pieces.find(item => item.name === 'dense_vectors_hnsw').path, 'fixture-native.bin');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8')), checksum = await checksumFile(statePath);
    if (selected === 'concurrent-state') assert.equal(state.sqlite.count, 9);
    assert.equal(manifest.pieces.find(item => item.name === 'index_state').checksum, `${checksum.algo}:${checksum.value}`);
  } else if (['stale-attempt', 'validation-stale-attempt'].includes(selected)) {
    const original = await claim('attempt-a');
    if (selected === 'stale-attempt') {
      await claim('attempt-b'); const current = await fs.readFile(manifestPath, 'utf8');
      await assert.rejects(publish({ publicationState: original }), { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
      assert.equal(await fs.readFile(manifestPath, 'utf8'), current);
    } else {
      let validations = 0, receipts = 0;
      await assert.rejects(publishEmbeddingGeneration({ statePath, indexState: original,
        publishManifest: () => claim('attempt-b'), validate: async () => { validations++; return { ok: true }; },
        commitReceipt: async () => { receipts++; } }), { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
      assert.equal(validations, 0); assert.equal(receipts, 0);
      assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).extensions.runtimeAttemptId, 'attempt-b');
    }
  } else if (['receipt-lock', 'validation-pending', 'receipt-pending', 'receipt-revokes-validation', 'validation-getter'].includes(selected)) {
    const state = await claim('attempt-a');
    let receipts = 0;
    const revoke = ['receipt-revokes-validation', 'validation-getter'].includes(selected);
    if (revoke) settled = true;
    const validation = Object.freeze({ get ok() { if (selected === 'validation-getter') settled = false; return true; },
      cacheOwnershipReleased: pending.cacheOwnershipReleased.bind(pending) });
    const run = () => publishEmbeddingGeneration({ statePath, indexState: state,
      publishManifest: () => publish({ publicationState: state }),
      validate: async () => selected === 'validation-pending' || revoke ? validation : { ok: true },
      commitReceipt: async () => {
        receipts++;
        const lockPath = path.join(root, '.index_state.write.lock');
        assert.equal(JSON.parse(await fs.readFile(lockPath, 'utf8')).scope, 'index-state-publication');
        const competing = await acquireFileLock({ lockPath, waitMs: 0, staleMs: Number.MAX_SAFE_INTEGER });
        assert.equal(competing, null, 'ready receipt remains inside the actual original publication owner');
        if (selected === 'receipt-revokes-validation') settled = false;
        return selected === 'receipt-pending' ? pending : undefined;
      } });
    if (selected === 'receipt-lock') { assert.equal((await run()).ok, true); assert.equal(receipts, 1); }
    else {
      await assert.rejects(run(), error => { failure = error; return true; });
      assert.equal(receipts, ['validation-pending', 'validation-getter'].includes(selected) ? 0 : 1);
      assert.equal(errorGraphIncludes(failure, selected === 'validation-pending' || revoke ? validation : pending), true);
      assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).embeddings.ready, false);
      let session; errorGraphSome(failure, value => { session = value?.fileLockPublicationSession; return Boolean(session); });
      assert.ok(session); assert.equal(failure.cacheOwnershipReleased(), false);
      settled = true; await session.releaseAfterClose(); assert.equal(failure.cacheOwnershipReleased(), true);
      failure = null;
    }
  } else if (['unmarked-primary-read', 'primary-backup'].includes(selected)) {
    await fs.writeFile(manifestPath + '.bak', before);
    if (selected === 'primary-backup') {
      await fs.writeFile(manifestPath, '{truncated'); await publish();
      assert.ok(JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces.some(item => item.name === 'unrelated'));
    } else { faultPath = manifestPath; await assert.rejects(publish(), error => { failure = error; return true; }); }
  } else if (selected === 'pending-binary-meta') {
    await fs.writeFile(binaryPath, Buffer.from([1, 2, 3, 4])); await fs.writeFile(binaryMetaPath, '{}');
    faultPath = binaryMetaPath;
    await assert.rejects(publish({ embeddingGeneration: 'current-generation' }), error => { failure = error; return true; });
  } else {
    await fs.writeFile(path.join(root, 'dense_vectors_uint8.meta.json'), 'null');
    await assert.rejects(publish(), error => { failure = error; return /shard metadata/u.test(error.message); });
  }
  faultPath = null; asyncFaultPath = null;
  if (failure) {
    assert.equal(await fs.readFile(manifestPath, 'utf8'), before, 'required read/hash failure cannot replace the original manifest');
    if (pendingFault) {
      assert.equal(errorGraphIncludes(failure, pending), true); assert.equal(failure.cacheOwnershipReleased(), false);
      let session; errorGraphSome(failure, value => { session = value?.fileLockPublicationSession; return Boolean(session); });
      assert.ok(session); settled = true; await session.releaseAfterClose(); assert.equal(failure.cacheOwnershipReleased(), true);
    }
  }
  await assert.rejects(fs.stat(path.join(root, '.index_state.write.lock')), { code: 'ENOENT' });
} finally {
  settled = true; faultPath = null; asyncFaultPath = null; injectExtent = false;
  fsSync.openSync = originalOpen; fs.open = originalAsyncOpen; fs.stat = originalStat;
  release?.(); if (held) await held;
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Embedding manifest publication ownership: ${selected}`);
