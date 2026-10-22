import assert from 'node:assert/strict';
import { captureSceneResource, getPendingSceneResourceOwners, preserveSceneCleanupFailures } from '../../src/map/isometric/client/scene-retirement.js';
import { clearGroup, disposeObject } from '../../src/map/isometric/client/scene-utils.js';
import { createEnvironmentOwner } from '../../src/map/isometric/client/environment-owner.js';
import { retireResidentScene } from '../../src/map/isometric/client/rendering/resident-scene.js';

// Inert actual-owner controls only. No Three import, browser, WebGL or GPU.
const leaf = Object.freeze(new Error('original frozen scene leaf'));
const nativeFailure = Object.freeze(new AggregateError([leaf], 'frozen scene close failure', { cause: leaf }));
const caught = invoke => { try { invoke(); assert.fail('expected pending exact scene owner'); } catch (error) {
  assert.equal(error.sceneOwnershipPending, true); return error;
} };
const resource = (label, errors = []) => ({ label, errors, calls: 0, dispose() {
  this.calls++; if (this.errors.length) throw this.errors.shift();
} });
const group = children => ({ children, traverse(visitor) { visitor(this); for (const child of [...this.children]) visitor(child); },
  remove(child) { this.children.splice(this.children.indexOf(child), 1); } });
const baseline = new Set(getPendingSceneResourceOwners());
try {
  const instance = resource('instance', [nativeFailure, nativeFailure]);
  instance.isInstancedMesh = true; instance.userData = {};
  const geometry = resource('geometry', [nativeFailure]), texture = resource('texture');
  const material = resource('material'); material.map = texture;
  instance.geometry = geometry; instance.material = material;
  const shared = resource('shared geometry'); shared.userData = { shared: true };
  const sibling = resource('sibling'); sibling.isInstancedMesh = true; sibling.geometry = shared; sibling.material = material;
  const root = group([instance, sibling]);
  const error = caught(() => clearGroup(root));
  assert.equal(root.children.length, 0, 'pending resources retain exact capabilities after detachment');
  assert.equal(instance.calls, 1); assert.equal(sibling.calls, 1); assert.equal(geometry.calls, 1);
  assert.equal(texture.calls, 1); assert.equal(material.calls, 1); assert.equal(shared.calls, 0);
  assert.equal(nativeFailure.cause, leaf); assert.deepEqual(nativeFailure.errors, [leaf]);
  const owners = error.sceneResourceOwners;
  const instanceOwner = owners.find(owner => owner.resource === instance), geometryOwner = owners.find(owner => owner.resource === geometry);
  assert.equal(instanceOwner.lastError.cause, nativeFailure); assert.deepEqual(instanceOwner.lastError.errors, [nativeFailure]);
  instance.dispose = () => assert.fail('keep original instanced dispose'); geometry.dispose = () => assert.fail('keep original geometry dispose');
  caught(() => disposeObject(instance)); assert.equal(instance.calls, 1, 'later group retirement does not automatically retry observed failure');
  caught(() => instanceOwner.release()); assert.equal(instance.calls, 2);
  instanceOwner.release(); geometryOwner.release(); assert.equal(instance.calls, 3); assert.equal(geometry.calls, 2);
  assert.equal(error.sceneOwnershipReleased(), true);
  disposeObject(instance); assert.equal(instance.calls, 3); assert.equal(texture.calls, 1); assert.equal(material.calls, 1);

  let complete;
  const asynchronous = { calls: 0, dispose() { this.calls++; return new Promise(resolve => { complete = resolve; }); } };
  const asynchronousOwner = captureSceneResource(asynchronous, 'controlled async child');
  const waiting = caught(() => asynchronousOwner.retire());
  caught(() => asynchronousOwner.release()); assert.equal(asynchronous.calls, 1);
  complete(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(waiting.sceneOwnershipReleased(), true); asynchronousOwner.release(); assert.equal(asynchronous.calls, 1);

  // Unknown child settlement is not inferred from successful outer disposal.
  let externalClosed = false;
  const child = new Error('original nested observer');
  Object.defineProperties(child, { sceneOwnershipPending: { value: true }, sceneOwnershipReleased: { value() {
    assert.equal(this, child); return externalClosed;
  } } }); Object.freeze(child);
  const nested = resource('nested', [child]), nestedOwner = captureSceneResource(nested);
  const nestedFailure = caught(() => nestedOwner.retire());
  caught(() => nestedOwner.release()); assert.equal(nested.calls, 2);
  externalClosed = true; nestedOwner.release(); assert.equal(nested.calls, 2, 'successful close is remembered while child remains pending');
  assert.equal(nestedFailure.sceneOwnershipReleased(), true);

  const conversion = Object.freeze(new AggregateError([leaf], 'frozen conversion failure', { cause: leaf }));
  const generators = [], inputs = [], targets = []; let conversionFailure = false;
  const scene = { environment: null };
  const THREE = { EquirectangularReflectionMapping: 303, PMREMGenerator: class {
    constructor() { const entry = resource('generator'); this.entry = entry; generators.push(entry); this.dispose = entry.dispose.bind(entry); }
    fromEquirectangular() {
      if (conversionFailure) throw conversion;
      const target = resource('target'); target.texture = {}; targets.push(target); return target;
    }
  } };
  const environment = createEnvironmentOwner({ THREE, renderer: {}, scene });
  const input = () => { const value = resource('input'); inputs.push(value); return value; };
  environment.replace(input()); const accepted = targets[0]; accepted.errors.push(nativeFailure);
  const replacing = input();
  // Generator/input independently fail while the previous accepted target also
  // fails. The newly accepted target remains the actual scene environment.
  const oldConstructor = THREE.PMREMGenerator;
  THREE.PMREMGenerator = class extends oldConstructor {
    constructor() { super(); this.entry.errors.push(nativeFailure); }
  };
  replacing.errors.push(nativeFailure);
  const replaceFailure = caught(() => environment.replace(replacing));
  assert.equal(scene.environment, targets[1].texture); assert.equal(accepted.calls, 1);
  assert.equal(generators[1].calls, 1); assert.equal(replacing.calls, 1);
  const previousOwner = replaceFailure.sceneResourceOwners.find(owner => owner.resource === accepted);
  accepted.dispose = () => assert.fail('previous PMREM target keeps captured method');
  conversionFailure = true;
  const failedInput = input(); failedInput.errors.push(nativeFailure);
  const failedConversion = caught(() => environment.replace(failedInput));
  assert.equal(failedConversion.cause, conversion); assert.equal(failedConversion.errors[0], conversion);
  assert.equal(scene.environment, targets[1].texture); assert.equal(accepted.calls, 1, 'later replacement never retries previous failure');
  const disposalFailure = caught(() => environment.dispose());
  assert.equal(scene.environment, null); assert.equal(targets[1].calls, 1); assert.equal(accepted.calls, 1);
  for (const owner of [...replaceFailure.sceneResourceOwners, ...failedConversion.sceneResourceOwners]) owner.release();
  assert.equal(previousOwner.pending, false); environment.dispose();
  assert.equal(disposalFailure.sceneOwnershipReleased(), true); assert.equal(targets[1].calls, 1);
  const late = input(); late.errors.push(nativeFailure);
  const lateFailure = caught(() => environment.replace(late));
  assert.equal(generators.length, 3, 'retired environment never constructs another PMREM generator');
  lateFailure.sceneResourceOwner.release(); assert.equal(environment.replace(late), false); assert.equal(late.calls, 2);

  const stageFailure = resource('retired resident buffer', [nativeFailure]);
  const independent = resource('independent resident buffer');
  const candidate = { retired: false, published: false, values: { stackPipeOwners: [stageFailure, independent], stackPacketOwner: independent } };
  const candidateFailure = caught(() => retireResidentScene(candidate));
  assert.equal(independent.calls, 1, 'resident buffer aliases dispose once');
  assert.equal(caught(() => retireResidentScene(candidate)), candidateFailure); assert.equal(stageFailure.calls, 1);
  candidateFailure.sceneResourceOwner.release(); assert.equal(stageFailure.calls, 2);
  const frozenPrimary = Object.freeze(new Error('original preparation failure'));
  const combined = preserveSceneCleanupFailures(frozenPrimary, [candidateFailure]);
  assert.equal(combined.cause, frozenPrimary); assert.deepEqual(combined.errors, [frozenPrimary, candidateFailure]);
} finally {
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) {
    if (owner.resource?.errors) owner.resource.errors.length = 0;
    try { owner.release(); } catch {}
  }
}
console.log('Map exact failed-resource retirement controls authored; browser/GPU execution deferred.');
