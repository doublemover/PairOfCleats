import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMapViewerAsset, assertOptionalMapAssetFailure, MAP_VIEWER_ASSET_BYTES } from '../../tools/analysis/map-viewer-asset-read.js';
import { pinMapViewerAssets } from '../../tools/analysis/map-viewer-session-assets.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

const thrown = async action => { try { await action(); } catch (error) { return error; } throw new Error('Expected original asset failure.'); };
const includes = (error, wanted, visited = new Set()) => {
  if (Object.is(error, wanted)) return true;
  if (!error || typeof error !== 'object' || visited.has(error)) return false;
  visited.add(error);
  return includes(error.cause, wanted, visited) || (error.errors || []).some(value => includes(value, wanted, visited));
};
const fixture = ({ readFailure, failsRead = false, closeFailure, failsClose = false, mutate = false, raw = Buffer.from('bytes') } = {}) => {
  const snapshot = { dev: 1n, ino: 2n, size: BigInt(raw.length), mtimeNs: 3n, ctimeNs: 4n, isFile: () => true };
  const state = { opens: 0, closes: 0, stats: 0, readFailure, failsRead, closeFailure, failsClose, mutate };
  const handle = {
    async stat() { assert.equal(this, handle); state.stats++; return snapshot; },
    async *createReadStream() {
      assert.equal(this, handle);
      if (state.failsRead) throw state.readFailure;
      yield raw;
      if (state.mutate) raw.fill(0);
      handle.stat = () => { throw new Error('replacement stat must not run'); };
    },
    async close() { assert.equal(this, handle); state.closes++; if (state.failsClose) throw state.closeFailure; }
  };
  const fsImpl = { async open() { state.opens++; return handle; }, async stat() { assert.equal(this, fsImpl); return snapshot; } };
  return { handle, state, fsImpl, read: () => readMapViewerAsset('original-asset.js', { fsImpl }) };
};
{
  const f = fixture({ mutate: true });
  assert.equal((await f.read()).toString(), 'bytes', 'retained chunks do not alias reused read buffers');
  assert.equal(f.state.stats, 2, 'the original descriptor method supplies both observations');
  assert.equal(f.state.closes, 1);
}
for (const primary of [Object.freeze(new Error('original read failed')), null, undefined, false, 0, 'read failed']) {
  const closeFailure = Object.freeze(new Error('original close failed'));
  const f = fixture({ readFailure: primary, failsRead: true, closeFailure, failsClose: true });
  const failure = await thrown(f.read);
  assert.equal(failure.cause, primary);
  assert(includes(failure, closeFailure));
  assert.throws(() => assertOptionalMapAssetFailure(failure), error => includes(error, primary) && includes(error, closeFailure));
  const owner = getPendingSceneResourceOwners().find(value => value.resource === f.handle);
  assert(owner, 'failed asset descriptors remain strongly retained by the existing resource owner');
  f.handle.close = () => { throw new Error('replacement close must not run'); };
  f.state.failsClose = false;
  await owner.releaseAsync();
  assert.equal(f.state.closes, 2);
  await owner.releaseAsync();
  assert.equal(f.state.closes, 2, 'fulfilled original close is not repeated');
  assert.equal(f.state.opens, 1, 'reconciliation never opens a sibling descriptor');
}
{
  let released = false;
  const pending = Object.freeze(Object.defineProperty(new Error('native read remains pending'),
    'cacheOwnershipReleased', { value: () => released }));
  const f = fixture({ failsRead: true, readFailure: pending });
  const failure = await thrown(f.read);
  assert(includes(failure, pending));
  assert.equal(f.state.closes, 0, 'actual close waits for original native read observations');
  const owner = getPendingSceneResourceOwners().find(value => value.resource === f.handle);
  await assert.rejects(owner.releaseAsync());
  assert.equal(f.state.closes, 0);
  released = true; await owner.releaseAsync();
  assert.equal(f.state.closes, 1);
}
{
  let sceneDone = false, cacheDone = false, adopted = 0;
  const lookalike = { release() { adopted++; } };
  const original = Object.freeze(Object.defineProperties(new Error('independent original read channels'), {
    sceneResourceOwner: { value: lookalike }, sceneOwnershipReleased: { value: () => sceneDone },
    cacheOwnershipReleased: { value: () => cacheDone }
  }));
  const f = fixture({ failsRead: true, readFailure: original });
  await thrown(f.read);
  const owner = getPendingSceneResourceOwners().find(value => value.resource === f.handle);
  sceneDone = true;
  await assert.rejects(owner.releaseAsync());
  assert.equal(f.state.closes, 0, 'one fulfilled channel cannot delegate an independent original cache blocker');
  assert.equal(adopted, 0, 'public owner fields do not authorize a callback or sibling release');
  cacheDone = true; await owner.releaseAsync();
  assert.equal(f.state.closes, 1);
}
{
  const abort = new DOMException('native cancellation', 'AbortError');
  assert.throws(() => assertOptionalMapAssetFailure(abort), error => includes(error, abort), 'prototype AbortError names remain cancellation');
  const closeFailure = Object.freeze(new Error('optional descriptor close failed'));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  let opened = 0, failedHandle;
  const fsImpl = {
    async open(filePath) {
      opened++;
      const f = fixture({ raw: Buffer.alloc(0), failsClose: filePath.endsWith('normal.jpg'), closeFailure });
      if (filePath.endsWith('normal.jpg')) failedHandle = f;
      return f.handle;
    },
    async stat() { return { dev: 1n, ino: 2n, size: 0n, mtimeNs: 3n, ctimeNs: 4n }; }
  };
  const failure = await thrown(() => pinMapViewerAssets(root, '/three/three.module.js', { fsImpl }));
  assert(includes(failure, closeFailure), 'actual optional asset path cannot downgrade failed descriptor closure to a missing texture');
  assert(opened < 10, 'session preparation stops at the actual unclosed optional descriptor');
  failedHandle.state.failsClose = false;
  await getPendingSceneResourceOwners().find(owner => owner.resource === failedHandle.handle).releaseAsync();
}
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const missing = Object.assign(new Error('optional normal texture absent'), { code: 'ENOENT' });
  const fsImpl = {
    async open(filePath) {
      if (filePath.endsWith('normal.jpg')) throw missing;
      return fixture({ raw: Buffer.alloc(0) }).handle;
    },
    async stat() { return { dev: 1n, ino: 2n, size: 0n, mtimeNs: 3n, ctimeNs: 4n }; }
  };
  const pinned = await pinMapViewerAssets(root, '/three/three.module.js', { fsImpl });
  assert(pinned.assets.has('/isomap/viewer.js'));
  assert.deepEqual(pinned.unavailable, [{ route: '/assets/isomap/normal.jpg', reason: missing.message }], 'ordinary optional absence remains a supported source-only result');
  assert.match(pinned.identity, /^[a-f0-9]{64}$/);
}
{
  const f = fixture();
  f.handle.stat = async () => ({ isFile: () => true, size: BigInt(MAP_VIEWER_ASSET_BYTES + 1) });
  await assert.rejects(f.read(), /bounded regular file/);
  assert.equal(f.state.closes, 1);
}
console.log('Original viewer asset reads preserve descriptor, cancellation and optional-failure outcomes.');
