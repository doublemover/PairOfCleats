import assert from 'node:assert/strict';
import { createPickingResourceOwner } from '../../src/map/isometric/client/rendering/picking-resource-owner.js';
import { createPickFence } from '../../src/map/isometric/client/rendering/spatial-pick.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual scoped picker/resource/fence owners; all queries and closes are inert.
const baseline = new Set(getPendingSceneResourceOwners()), owners = [], done = [];
const caught = invoke => { try { invoke(); } catch (error) { return error; } assert.fail('expected original picking failure'); };
const pending = resource => getPendingSceneResourceOwners().find(owner => !baseline.has(owner) && owner.resource === resource);
const make = () => {
  const value = { indices: [], fences: [], current: true, state: { scene: {}, renderer: {}, sourceIndex: { snapshot: {} },
    geometryRevision: 1, cameraRevision: 1, getViewport: () => ({ width: 10, height: 10 }) } };
  value.options = { state: value.state, readDevicePixelRatio: () => 1,
    createIndex: () => {
      const index = { calls: 0, queryCalls: 0, query() { this.queryCalls++; value.query?.(); return {}; },
        intersect() { return { hits: ['original'], metrics: 'original metrics' }; }, dispose() { this.calls++; value.close?.(this); } };
      value.indices.push(index); value.index?.(index); return index;
    }, createFence: read => { const fence = createPickFence(read), original = fence.dispose;
      fence.calls = 0; fence.dispose = function() { this.calls++; return Reflect.apply(original, this, []); };
      value.fences.push(fence); return fence; } };
  value.owner = createPickingResourceOwner({ ...value.options, isCurrent: () => value.current }); owners.push(value.owner);
  value.pick = owner => (owner || value.owner).pick({ ray: {} }, { x: 0, y: 0 }, () => []);
  return value;
};
try {
  const scoped = make(); assert.deepEqual(scoped.pick(), ['original']);
  const [index] = scoped.indices, [fence] = scoped.fences;
  const sibling = createPickingResourceOwner(scoped.options); owners.push(sibling); scoped.pick(sibling);
  scoped.current = false; scoped.owner.retireCaptured();
  assert.equal(scoped.state.pickIndex, index); assert.equal(scoped.state.pickFence, fence);
  assert.deepEqual([index.calls, fence.calls], [0, 0], 'older actual controls cannot retire a newer exact claim');
  sibling.retireCaptured(); assert.deepEqual([index.calls, fence.calls], [1, 1]);

  const cancellation = make(); cancellation.pick(); const originalFence = cancellation.fences[0];
  originalFence.cancel = () => assert.fail('later cancellation field cannot replace original captured method');
  cancellation.owner.cancelCaptured();
  const unrelated = { cancel() { assert.fail('controls cancellation cannot adopt an uncaptured current fence'); } };
  cancellation.state.pickFence = unrelated; cancellation.owner.cancelCaptured(); cancellation.owner.retireCaptured();
  assert.equal(cancellation.state.pickFence, unrelated); assert.equal(originalFence.calls, 1);

  const global = make(); global.pick(); const authoritative = createPickingResourceOwner(global.options); owners.push(authoritative);
  authoritative.retire(); global.owner.retireCaptured();
  assert.deepEqual([global.indices[0].calls, global.fences[0].calls], [1, 1], 'global rebuild and controls retirement share one original native capability');

  const never = make(), unrelatedIndex = { dispose() { assert.fail('stale controls cannot capture sibling slots'); } }, unrelatedFence = { dispose() { assert.fail('stale controls cannot close sibling slots'); } };
  never.current = false; never.state.pickIndex = unrelatedIndex; never.state.pickFence = unrelatedFence;
  assert.deepEqual(never.pick(), []); never.owner.retireCaptured(); assert.equal(never.state.pickIndex, unrelatedIndex); assert.equal(never.state.pickFence, unrelatedFence);
  assert.equal(never.indices.length, 0);

  // Method capture reentrancy can retire an acquired original before it is
  // published. Its returned function must never run on that closed resource.
  const closedCapture = make(); let queryReads = 0, captured;
  closedCapture.index = index => { captured = index; Object.defineProperty(index, 'query', { get() {
    queryReads++; closedCapture.state.pickIndex = index;
    const globalOwner = createPickingResourceOwner(closedCapture.options); owners.push(globalOwner); globalOwner.retire();
    return () => assert.fail('callback returned after original disposal cannot run');
  } }); };
  caught(closedCapture.pick); assert.equal(captured.calls, 1); assert.equal(queryReads, 1); assert.equal(closedCapture.state.pickIndex, null);

  const captureFailure = make(); let disposeReads = 0;
  const original = Object.freeze(new Error('original dispose capture'));
  captureFailure.index = index => Object.defineProperty(index, 'dispose', { get() { disposeReads++; throw original; } });
  const failed = caught(captureFailure.pick); assert.equal(failed.cause.cause, original); assert.equal(disposeReads, 1);
  assert.equal(captureFailure.indices[0].queryCalls, 0); caught(() => pending(captureFailure.indices[0]).release()); assert.equal(disposeReads, 1);

  // Actual native query work blocks even authoritative global teardown while
  // its accepted stack is active; explicit exact reconciliation is separate.
  const active = make(); let during, failure;
  const globalActive = createPickingResourceOwner(active.options); owners.push(globalActive);
  active.query = () => { failure = caught(globalActive.retire); during = [active.indices[0].calls, active.fences[0].calls]; };
  assert.deepEqual(active.pick(), []); assert.deepEqual(during, [0, 0]);
  pending(active.indices[0]).release(); pending(active.fences[0]).release(); active.owner.retireCaptured();
  assert.deepEqual([active.indices[0].calls, active.fences[0].calls], [1, 1]); assert.equal(failure.sceneOwnershipReleased(), true);

  let ready = false; done.push(() => { ready = true; });
  const work = Object.freeze(Object.defineProperty(new Error('independent original picking work'), 'cacheOwnershipReleased', { value: () => ready }));
  const mixed = make(); mixed.query = () => { throw work; }; const mixedFailure = caught(mixed.pick);
  caught(() => pending(mixed.indices[0]).release()); caught(() => pending(mixed.fences[0]).release());
  assert.deepEqual([mixed.indices[0].calls, mixed.fences[0].calls], [0, 0]); ready = true;
  pending(mixed.indices[0]).release(); pending(mixed.fences[0]).release(); assert.equal(mixedFailure.sceneOwnershipReleased(), true);

  const unknown = Object.freeze(Object.assign(new Error('unknown original native work'), { sceneOwnershipPending: true,
    sceneResourceOwner: { release() { assert.fail('public copied owner cannot authorize original picker closure'); } } }));
  const blocked = make(); blocked.query = () => { throw unknown; }; const blockedFailure = caught(blocked.pick);
  caught(() => pending(blocked.indices[0]).release()); caught(() => pending(blocked.fences[0]).release());
  assert.deepEqual([blocked.indices[0].calls, blocked.fences[0].calls], [0, 0]); assert.equal(blockedFailure.sceneOwnershipReleased(), false);
} finally {
  for (const complete of done) complete();
  for (const owner of owners) { try { owner.retireCaptured(); } catch {} }
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
}
console.log('Actual original scoped/global picking ownership controls authored; execution deferred.');
