import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { initMaterials } from '../../src/map/isometric/client/materials.js';
import { createNormalMapOwner, retireNormalMapState } from '../../src/map/isometric/client/normal-map-owner.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual material loader and texture owner; inert constructors, no Three/DOM/GPU.
const original = { ...state }, baseline = new Set(getPendingSceneResourceOwners());
const loads = [], resources = [];
let syncLoad = false, syncError = false, syncErrorValue, releaseNative = null;
const texture = ({ fail = false, unconfirmed = false } = {}) => {
  const value = { calls: 0, fail, unconfirmed, configured: 0, userData: {},
    repeat: { set() { value.configured++; } },
    dispose() { this.calls++; if (this.fail) throw cleanup; if (this.unconfirmed) { this.unconfirmed = false; return false; } }
  };
  resources.push(value); return value;
};
const cleanup = Object.freeze(new Error('controlled original normal-map cleanup'));
const THREE = { RepeatWrapping: 1000, Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
  TextureLoader: class {
    load(url, loaded, progress, failed) {
      const returned = texture(); const load = { url, loaded, failed, returned }; loads.push(load);
      if (syncLoad) loaded(returned);
      if (syncError) failed(syncErrorValue);
      return returned;
    }
  }
};
const glass = { normalRepeat: 3, normalScale: .4, clearcoatNormalScale: .2, transmission: .2,
  metalness: .1, roughness: .1, ior: 1.2, reflectivity: .4, thickness: .5, envMapIntensity: 1,
  clearcoat: .1, clearcoatRoughness: .1 };
const setup = () => {
  Object.assign(state, { THREE, assets: { normalMapUrl: 'fixture-normal-map' }, visuals: { glass },
    visualDefaults: { glass }, scene: {}, normalMapState: null, normalMapFailure: null,
    sceneRetirementOwners: [], disposeScene() {}, invalidateRender() {} });
};
const releaseNew = () => {
  for (const value of resources) value.fail = false;
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { owner.release(); } catch {} }
};
try {
  setup(); initMaterials();
  const first = loads.at(-1), firstOwner = state.normalMapState;
  assert.equal(firstOwner.texture, null); assert.equal(first.returned.calls, 0);
  let substitutes = 0; first.returned.dispose = () => { substitutes++; };
  const material = { userData: {} }; state.glassMaterials.push(material);
  first.loaded(first.returned);
  assert.equal(firstOwner.texture, first.returned); assert.equal(first.returned.userData.shared, true);
  assert.equal(material.normalMap, first.returned); assert.equal(material.clearcoatNormalMap, first.returned,
    'async normal-map completion updates materials created before the texture completed');
  assert.equal(material.needsUpdate, true);
  retireNormalMapState(firstOwner); assert.equal(first.returned.calls, 1); assert.equal(substitutes, 0);
  assert.equal(firstOwner.texture, null); const configured = first.returned.configured;
  first.loaded(first.returned); assert.equal(first.returned.calls, 1); assert.equal(first.returned.configured, configured);

  setup(); initMaterials();
  const uncompleted = loads.at(-1), uncompletedOwner = state.normalMapState;
  uncompleted.returned.dispose = () => { substitutes++; };
  retireNormalMapState(uncompletedOwner);
  assert.equal(uncompleted.returned.calls, 1, 'returned allocation closes even when no completion callback has arrived');
  assert.equal(substitutes, 0);

  setup(); initMaterials(); const older = loads.at(-1), olderOwner = state.normalMapState;
  initMaterials(); const newer = loads.at(-1), newerOwner = state.normalMapState;
  assert.equal(older.returned.calls, 1); assert.notEqual(olderOwner, newerOwner);
  newer.loaded(newer.returned); const accepted = newerOwner.texture;
  const late = texture({ fail: true }); older.loaded(late);
  assert.equal(late.calls, 1); assert.equal(state.normalMapState, newerOwner); assert.equal(newerOwner.texture, accepted);
  assert.equal(state.normalMapFailure, null, 'old callback failure cannot overwrite current texture diagnostics');
  assert.equal(olderOwner.failure.sceneOwnershipPending, true);
  assert.ok(getPendingSceneResourceOwners().some(owner => owner.resource === late));
  late.dispose = () => { substitutes++; }; older.loaded(late); assert.equal(late.calls, 1, 'late callback does not retry known failed cleanup');
  releaseNew(); assert.equal(late.calls, 2); assert.equal(substitutes, 0);
  retireNormalMapState(newerOwner); assert.equal(newer.returned.calls, 1);

  setup(); syncLoad = true; initMaterials(); syncLoad = false;
  const synchronous = loads.at(-1); assert.equal(state.normalMapState.texture, synchronous.returned);
  retireNormalMapState(state.normalMapState); assert.equal(synchronous.returned.calls, 1,
    'synchronous callback and returned resource share one captured texture owner');

  for (const value of [undefined, null, false, 0, '']) {
    setup(); syncError = true; syncErrorValue = value; initMaterials(); syncError = false;
    const failed = loads.at(-1);
    assert.equal(state.normalMapFailure.cause, value); assert.equal(failed.returned.calls, 1);
    assert.equal(state.normalMapState.texture, null);
    retireNormalMapState(state.normalMapState); assert.equal(failed.returned.calls, 1);
  }

  setup(); let nativeSettled = false, replaceObserver = false, observerReads = 0;
  releaseNative = () => { nativeSettled = true; };
  const originalObserver = function () { assert.equal(this, nativeFailure); return nativeSettled; };
  const nativeFailure = Object.freeze(Object.defineProperties(new Error('original texture loading work remains pending'), {
    cacheOwnershipReleased: { get() { observerReads++; return replaceObserver ? () => true : originalObserver; } }
  }));
  syncError = true; syncErrorValue = nativeFailure;
  assert.throws(() => initMaterials(), error => error.cause === nativeFailure && error.sceneOwnershipPending === true);
  syncError = false;
  const pending = loads.at(-1), pendingOwner = state.normalMapState;
  assert.equal(pending.returned.calls, 0, 'error-before-return evidence also gates the subsequently returned texture');
  assert.equal(pendingOwner.pendingOwners.length, 1);
  replaceObserver = true;
  assert.throws(() => retireNormalMapState(pendingOwner), error => error.sceneOwnershipPending === true);
  assert.equal(pending.returned.calls, 0); assert.equal(observerReads, 1);
  nativeSettled = true; releaseNew(); retireNormalMapState(pendingOwner); assert.equal(pending.returned.calls, 1);

  setup(); initMaterials(); const unconfirmed = loads.at(-1), unconfirmedOwner = state.normalMapState;
  unconfirmed.returned.unconfirmed = true;
  assert.throws(() => retireNormalMapState(unconfirmedOwner), error => error.sceneOwnershipPending === true);
  assert.equal(unconfirmed.returned.calls, 1); releaseNew(); retireNormalMapState(unconfirmedOwner);
  assert.equal(unconfirmed.returned.calls, 2, 'false child disposal is unconfirmed until explicit original reconciliation');

  const replacementOwner=createNormalMapOwner({isCurrent:()=>true,configure(){}});
  const previous=texture({fail:true}),next=texture(),last=texture();
  replacementOwner.accept(previous);
  assert.throws(()=>replacementOwner.accept(next),error=>error.sceneOwnershipPending===true);
  assert.equal(replacementOwner.texture,next);assert.equal(next.calls,0);assert.equal(previous.calls,1);
  replacementOwner.accept(last);assert.equal(replacementOwner.texture,last);assert.equal(next.calls,1);assert.equal(previous.calls,1);
  assert.throws(()=>retireNormalMapState(replacementOwner));assert.equal(last.calls,1);assert.equal(previous.calls,1);
  releaseNew();retireNormalMapState(replacementOwner);assert.equal(previous.calls,2);assert.equal(last.calls,1);

  // A foreign wrapper containing one known actual owner still has its own
  // independent unknown receipt. Public fields/causal membership are no proof
  // that this normal-map owner may ignore that original receipt.
  const known=texture({fail:true}),knownOwner=createNormalMapOwner({isCurrent:()=>true,configure(){}});
  knownOwner.track(known);let knownFailure;
  assert.throws(()=>retireNormalMapState(knownOwner),error=>{knownFailure=error;return true;});
  let foreignSettled=false;const unknown=Object.freeze(new Error('independent unknown foreign native work'));
  releaseNative=()=>{nativeSettled=true;foreignSettled=true;};
  const foreign=Object.freeze(Object.defineProperties(new AggregateError([knownFailure,unknown],'foreign mixed failure'),{
    sceneResourceOwner:{value:knownFailure.sceneResourceOwner},sceneResourceOwners:{value:knownFailure.sceneResourceOwners},
    sceneOwnershipReleased:{value:knownFailure.sceneOwnershipReleased},
    cacheOwnershipReleased:{value(){assert.equal(this,foreign);return foreignSettled;}}
  }));
  const candidate=texture(),foreignOwner=createNormalMapOwner({isCurrent:()=>true,configure(){throw foreign;}});
  foreignOwner.track(candidate);
  assert.throws(()=>foreignOwner.accept(candidate),error=>error.cause===foreign&&error.sceneOwnershipPending===true);
  releaseNew();assert.equal(knownFailure.sceneOwnershipReleased(),true);assert.equal(candidate.calls,0,
    'settling the known child cannot release the independent foreign observation');
  assert.throws(()=>retireNormalMapState(foreignOwner));assert.equal(candidate.calls,0);
  foreignSettled=true;releaseNew();retireNormalMapState(foreignOwner);assert.equal(candidate.calls,1);
} finally {
  syncLoad = false; syncError = false; releaseNative?.(); releaseNew();
  try { retireNormalMapState(state.normalMapState); } catch {}
  releaseNew();
  for (const key of Object.keys(state)) if (!Object.hasOwn(original, key)) delete state[key];
  Object.assign(state, original);
}
console.log('Actual normal-map returned allocation/completion/late/error/material controls authored; browser/GPU execution deferred.');
