import assert from 'node:assert/strict';
import { captureSceneResource, getPendingSceneResourceOwners, preserveSceneCleanupFailures } from '../../src/map/isometric/client/scene-retirement.js';
import { createEnvironmentOwner } from '../../src/map/isometric/client/environment-owner.js';

// Inert exact source controls; no browser, Three, WebGL or native resources.
const caught = invoke => { let captured = false, value; try { invoke(); } catch (error) { captured = true; value = error; }
  assert.equal(captured, true); return value; };
for (const thrown of [undefined, null, false, 0, '']) {
  let getterCalls = 0;
  const resource = Object.defineProperty({}, 'dispose', { get() { getterCalls++; throw thrown; } });
  const owner = captureSceneResource(resource, 'falsey disposal getter');
  const failure = caught(() => owner.retire());
  assert.equal(failure.cause, thrown); assert.deepEqual(failure.errors, [thrown]);
  assert.equal(failure.sceneResourceOwner, owner); assert.equal(owner.pending, true);
  caught(() => owner.release()); assert.equal(getterCalls, 1, 'reconciliation cannot replace unknown captured disposal');

  let generatorCloses = 0, inputCloses = 0;
  const THREE = { PMREMGenerator: class { fromEquirectangular() { throw thrown; } dispose() { generatorCloses++; } } };
  const environment = createEnvironmentOwner({ THREE, renderer: {}, scene: { environment: null } });
  const conversion = caught(() => environment.replace({ dispose() { inputCloses++; } }));
  assert.ok(conversion instanceof AggregateError); assert.equal(conversion.cause, thrown); assert.deepEqual(conversion.errors, [thrown]);
  assert.equal(generatorCloses, 1); assert.equal(inputCloses, 1); environment.dispose();

  const cleanupOnly = preserveSceneCleanupFailures(null, [thrown]);
  assert.ok(cleanupOnly instanceof AggregateError); assert.equal(cleanupOnly.cause, thrown); assert.deepEqual(cleanupOnly.errors, [thrown]);
}

let sceneReleased = false, cacheReleased = false, sceneObservations = 0, cacheObservations = 0, closes = 0;
const original = new Error('independent scene and cache receipts');
Object.defineProperties(original, { sceneOwnershipPending: { value: true }, cacheOwnershipPending: { value: true },
  sceneOwnershipReleased: { value() { assert.equal(this, original); sceneObservations++; return sceneReleased; } },
  cacheOwnershipReleased: { value() { assert.equal(this, original); cacheObservations++; return cacheReleased; } } }); Object.freeze(original);
const resource = { dispose() { closes++; if (closes === 1) throw original; } };
const owner = captureSceneResource(resource, 'two independent observers');
const failure = caught(() => owner.retire());
assert.equal(failure.cause, original); assert.equal(Object.hasOwn(failure, 'cacheOwnershipReleased'), false, 'original observer is not copied onto a different receiver');
sceneReleased = true;
caught(() => owner.release()); assert.equal(closes, 2); assert.equal(owner.pending, true);
assert.ok(sceneObservations > 0); assert.ok(cacheObservations > 0, 'both original receipts are observed independently');
cacheReleased = true; owner.release(); assert.equal(closes, 2, 'successful disposer is not repeated while independent receipt settles');
assert.equal(failure.sceneOwnershipReleased(), true);

sceneReleased = true; cacheReleased = false;
const combined = preserveSceneCleanupFailures(original, [], { hasPrimary: true });
assert.equal(combined.cause, original); assert.equal(combined.sceneOwnershipReleased(), false);
cacheReleased = true; assert.equal(combined.sceneOwnershipReleased(), true);
assert.ok(getPendingSceneResourceOwners().every(pending => pending !== owner));
// Intentionally unknown getter owners remain retained; these contain only JS
// fixture objects and no forged successful native closure.
console.log('Falsey map retirement and independent observer controls authored; all execution deferred.');
