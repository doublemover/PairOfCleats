import assert from 'node:assert/strict';
import { createPickingResourceOwner } from '../../src/map/isometric/client/rendering/picking-resource-owner.js';
import { createPickFence } from '../../src/map/isometric/client/rendering/spatial-pick.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual production owner/fence, inert index and synchronous disposal counters.
// No Three import, browser, renderer, native resource or GPU qualification.
const baseline = new Set(getPendingSceneResourceOwners()), finish = [];
const make = ({ makeIndex, makeFence } = {}) => {
  const state = { sourceIndex: { snapshot: {} }, geometryRevision: 1, cameraRevision: 1, scene: {}, renderer: {},
      getViewport: () => ({ width: 640, height: 480 }) }, indices = [], fences = [];
  const createIndex = options => {
    const value = makeIndex?.(options) || { calls: 0, query: () => ({ records: [] }),
      intersect: () => ({ hits: ['original hit'], metrics: { original: true } }), dispose() { this.calls++; } };
    indices.push(value); return value;
  };
  const createFence = read => {
    const value = makeFence?.(read) || createPickFence(read), original = value.dispose;
    value.calls = 0; value.dispose = function() { this.calls++; return original.call(this); };
    fences.push(value); return value;
  };
  const owner = createPickingResourceOwner({ state, createIndex, createFence, readDevicePixelRatio: () => 1 });
  return { state, indices, fences, owner, pick: () => owner.pick({ ray: {} }, { x: 1, y: 2 }, () => []) };
};
const fail = callback => { let threw = false; try { callback(); } catch (error) { threw = true; return error; }
  assert(threw, 'expected retained original owner failure'); };
const pendingFor = resource => getPendingSceneResourceOwners().find(owner => owner.resource === resource);
try {
  const normal = make(); assert.deepEqual(normal.pick(), ['original hit']);
  const [index] = normal.indices, [fence] = normal.fences;
  index.dispose = fence.dispose = () => assert.fail('original acquisition methods remain captured');
  index.query = index.intersect = fence.capture = fence.accept = () => assert.fail('later callback replacement is not original picking authority');
  normal.state.getViewport = () => assert.fail('original fence viewport reader remains captured');
  assert.deepEqual(normal.pick(), ['original hit']); normal.owner.retire(); normal.owner.retire();
  assert.deepEqual([index.calls, fence.calls], [1, 1]); assert.equal(normal.state.pickIndex, null); assert.equal(normal.state.pickFence, null);

  // One close failure cannot skip the independent original fence or replace
  // the exact frozen/falsey operation failures with a later cleanup outcome.
  let refusing = true; finish.push(() => { refusing = false; });
  const primary = Object.freeze(new Error('original index cleanup'));
  const broken = make({ makeIndex: () => ({ calls: 0, query: () => ({}), intersect: () => ({ hits: [], metrics: {} }),
    dispose() { this.calls++; if (refusing) throw primary; } }) });
  broken.pick(); const closeFailure = fail(() => broken.owner.retire()), brokenIndex = broken.indices[0];
  assert.equal(closeFailure.cause, primary); assert.equal(broken.fences[0].calls, 1);
  const firstNativeCalls = brokenIndex.calls; fail(() => broken.owner.retire()); assert.equal(brokenIndex.calls, firstNativeCalls);
  refusing = false; pendingFor(brokenIndex).release(); broken.owner.retire(); assert.equal(brokenIndex.calls, firstNativeCalls + 1);
  assert.equal(closeFailure.sceneOwnershipReleased(), true);

  let finishDisposal; const disposalFlight = new Promise(resolve => { finishDisposal = resolve; }); finish.push(finishDisposal);
  const asynchronous = make({ makeIndex: () => ({ calls: 0, query: () => ({}), intersect: () => ({ hits: [], metrics: {} }),
    dispose() { this.calls++; return disposalFlight; } }) });
  asynchronous.pick(); const asyncFailure = fail(() => asynchronous.owner.retire()), asyncIndex = asynchronous.indices[0];
  assert.equal(asynchronous.fences[0].calls, 1); assert.equal(asyncIndex.calls, 1);
  fail(() => asynchronous.owner.retire()); assert.equal(asyncIndex.calls, 1);
  const waiting = pendingFor(asyncIndex).releaseAsync(); finishDisposal(); await waiting; asynchronous.owner.retire();
  assert.equal(asyncIndex.calls, 1, 'fulfilled original disposal is joined and never repeated'); assert.equal(asyncFailure.sceneOwnershipReleased(), true);

  const partialFailure = Object.freeze(new Error('original fence acquisition'));
  const partial = make({ makeFence() { throw partialFailure; } });
  const partialResult = fail(partial.pick); assert.equal(partialResult.cause, partialFailure);
  assert.equal(partial.indices[0].calls, 1); assert.equal(partial.state.pickIndex, null);

  let rebuildingRefuses = true; finish.push(() => { rebuildingRefuses = false; });
  const rebuilding = make({ makeIndex: () => ({ calls: 0, query: () => ({}), intersect: () => ({ hits: [], metrics: {} }),
    dispose() { this.calls++; if (rebuildingRefuses) throw primary; } }) });
  rebuilding.pick(); rebuilding.state.geometryRevision++;
  const rebuildFailure = fail(rebuilding.pick), rebuildIndex = rebuilding.indices[0];
  assert.equal(rebuilding.fences[0].calls, 1, 'an old index close failure is not independent native work on its original fence');
  assert.equal(rebuilding.state.pickIndex, null); assert.equal(rebuilding.state.pickFence, null);
  assert.equal(rebuilding.indices.length, 1, 'failed old cleanup cannot silently publish its replacement');
  rebuildingRefuses = false; pendingFor(rebuildIndex).release(); rebuilding.owner.retire();
  assert.equal(rebuildFailure.sceneOwnershipReleased(), true);

  const falsey = make({ makeIndex: () => ({ calls: 0, query() { throw undefined; }, intersect() { assert.fail('failed query cannot intersect'); }, dispose() { this.calls++; } }) });
  const falseyFailure = fail(falsey.pick); assert.equal(falseyFailure.cause, undefined);
  assert.deepEqual([falsey.indices[0].calls, falsey.fences[0].calls], [1, 1]);

  const malformed = make(); malformed.pick(); const malformedIndex = malformed.indices[0];
  malformed.state.pickIndex = 0;
  const malformedFailure = fail(malformed.pick); assert(malformedFailure.cause instanceof TypeError);
  assert.equal(malformed.state.pickIndex, null); assert.equal(malformed.state.pickFence, null); assert.equal(malformed.fences[0].calls, 1);
  // The externally replaced original resource remains an exact captured cap,
  // rather than authority inferred from the malformed current slot.
  pendingFor(malformedIndex).release();

  // Both original slots are detached before any disposer. A reentrant new pick
  // publishes fresh resources which the old independent cleanup must preserve.
  let replacement, replacements = 0;
  const replacing = make({ makeIndex: () => ({ calls: 0, query: () => ({}), intersect: () => ({ hits: ['current'], metrics: {} }),
    dispose() { this.calls++; if (replacements++ === 0) { replacing.pick(); replacement = { index: replacing.state.pickIndex, fence: replacing.state.pickFence }; } } }) });
  replacing.pick(); const originalIndex = replacing.indices[0], originalFence = replacing.fences[0]; replacing.owner.retire();
  assert.equal(replacing.state.pickIndex, replacement.index); assert.equal(replacing.state.pickFence, replacement.fence);
  assert.deepEqual([originalIndex.calls, originalFence.calls, replacement.index.calls, replacement.fence.calls], [1, 1, 0, 0]); replacing.owner.retire();

  // Actual query reentrancy requests retirement while the original method is
  // still on the stack. Neither index nor fence can physically close yet.
  let during, activeFailure;
  const active = make({ makeIndex: () => ({ calls: 0,
    query() { activeFailure = fail(() => active.owner.retire()); during = [this.calls, active.fences[0].calls]; return {}; },
    intersect() { assert.fail('revoked original query cannot continue to intersect'); }, dispose() { this.calls++; } }) });
  assert.deepEqual(active.pick(), []); assert.deepEqual(during, [0, 0]);
  const activeIndex = active.indices[0], activeFence = active.fences[0];
  assert.equal(activeFailure.sceneOwnershipReleased(), false);
  fail(() => active.owner.retire()); assert.deepEqual([activeIndex.calls, activeFence.calls], [0, 0]);
  pendingFor(activeIndex).release(); pendingFor(activeFence).release(); active.owner.retire();
  assert.deepEqual([activeIndex.calls, activeFence.calls], [1, 1]); assert.equal(activeFailure.sceneOwnershipReleased(), true);

  // A failed original operation with independently pending work is a disposal
  // prerequisite, even if its method/observer fields are replaced afterward.
  let settled = false; finish.push(() => { settled = true; });
  const work = new Error('original query work'); let inspections = 0;
  Object.defineProperty(work, 'cacheOwnershipReleased', { configurable: true, get() { inspections++; return function() { assert.equal(this, work); return settled; }; } });
  const pending = make({ makeIndex: () => ({ calls: 0, query() { throw work; }, intersect() { assert.fail('pending original query cannot intersect'); }, dispose() { this.calls++; } }) });
  const operationFailure = fail(pending.pick), pendingIndex = pending.indices[0], pendingFence = pending.fences[0];
  Object.defineProperty(work, 'cacheOwnershipReleased', { value: () => true });
  fail(() => pendingFor(pendingIndex).release()); fail(() => pendingFor(pendingFence).release());
  assert.deepEqual([pendingIndex.calls, pendingFence.calls], [0, 0]); assert.equal(inspections, 1);
  settled = true; pendingFor(pendingIndex).release(); pendingFor(pendingFence).release(); pending.owner.retire();
  assert.deepEqual([pendingIndex.calls, pendingFence.calls], [1, 1]); assert.equal(operationFailure.sceneOwnershipReleased(), true);

  // Unknown pending markers and copied owner fields are evidence to retain,
  // never authority to invoke somebody else's reported release callback.
  const unknown = Object.freeze(Object.assign(new Error('unknown original query work'), { cacheOwnershipPending: true,
    sceneResourceOwner: { release() { assert.fail('reported owner fields cannot authorize sibling reconciliation'); } } }));
  const blocked = make({ makeIndex: () => ({ calls: 0, query() { throw unknown; }, intersect() {}, dispose() { this.calls++; } }) });
  const unknownFailure = fail(blocked.pick); fail(() => pendingFor(blocked.indices[0]).release()); fail(() => pendingFor(blocked.fences[0]).release());
  assert.deepEqual([blocked.indices[0].calls, blocked.fences[0].calls], [0, 0]); assert.equal(unknownFailure.sceneOwnershipReleased(), false);

  // Newer actual picking callbacks retain the resource; an older throwing
  // callback cannot clear or dispose the shared exact index/fence they used.
  let nesting = false, nested = false;
  const newer = make({ makeIndex: () => ({ calls: 0, query() { if (!nesting && !nested) {
    nesting = true; newer.pick(); nesting = false; nested = true; throw false; } return {}; },
  intersect: () => ({ hits: ['newer'], metrics: { newer: true } }), dispose() { this.calls++; } }) });
  const olderFailure = fail(newer.pick); assert.equal(olderFailure.cause, false);
  assert.equal(newer.state.pickIndex, newer.indices[0]); assert.equal(newer.state.pickFence, newer.fences[0]);
  assert.deepEqual([newer.indices[0].calls, newer.fences[0].calls], [0, 0]); assert.deepEqual(newer.state.pickMetrics, { newer: true }); newer.owner.retire();

  let revisionChanged = false;
  const revision = make({ makeIndex: () => ({ calls: 0, query: () => ({}), intersect: () => ({ hits: [], get metrics() {
    if (!revisionChanged) { revisionChanged = true; revision.state.sourceIndex = { snapshot: {} }; revision.state.pickMetrics = 'replacement'; } return 'obsolete';
  } }), dispose() { this.calls++; } }) });
  assert.deepEqual(revision.pick(), []); assert.equal(revision.state.pickMetrics, 'replacement'); revision.owner.retire();

  // A stale constructor's returned index is owned and retired without replacing
  // the sibling scene's independently installed original resources.
  const siblingIndex = { dispose() { assert.fail('late original constructor cannot adopt sibling index'); } };
  const siblingFence = { dispose() { assert.fail('late original constructor cannot adopt sibling fence'); } };
  const stale = make({ makeIndex: () => { stale.state.scene = {}; stale.state.pickIndex = siblingIndex; stale.state.pickFence = siblingFence;
    return { calls: 0, query() {}, intersect() {}, dispose() { this.calls++; } }; } });
  assert.deepEqual(stale.pick(), []); assert.equal(stale.indices[0].calls, 1);
  assert.equal(stale.state.pickIndex, siblingIndex); assert.equal(stale.state.pickFence, siblingFence);
} finally {
  for (const done of finish) done();
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
}
console.log('Actual resident picking original methods, independent teardown and active-work controls authored; execution deferred.');
