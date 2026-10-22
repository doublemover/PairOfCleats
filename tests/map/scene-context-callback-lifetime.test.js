import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { initScene } from '../../src/map/isometric/client/scene.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual scene listeners/environment callbacks with inert returned resources.
const originalState = { ...state }, originalWindow = globalThis.window, originalDocument = globalThis.document;
const baseline = new Set(getPendingSceneResourceOwners()), renderers = [], loads = [], disposers = [];
let conversions = 0, nativeSettled = false;
class Vector { set() { return this; } copy() { return this; } }
class Quaternion extends Vector { setFromEuler() { return this; } }
class Group {
  constructor() { this.children = []; this.userData = {}; }
  add(child) { this.children.push(child); }
  remove(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); }
  traverse(visit) { visit(this); for (const child of [...this.children]) { if (child.traverse) child.traverse(visit); else visit(child); } }
}
class Light { constructor() { this.position = new Vector(); this.shadow = { mapSize: new Vector(), camera: {}, dispose() {} }; } }
class Renderer {
  constructor() {
    this.calls = 0; this.shadowMap = {};
    this.domElement = { style: {}, removed: 0, listeners: new Map(),
      addEventListener(event, callback) { this.listeners.set(event, callback); },
      removeEventListener(event) { this.listeners.delete(event); }, remove() { this.removed++; } };
    renderers.push(this);
  }
  setPixelRatio() {} setSize() {}
  dispose() { this.calls++; }
}
class Camera { constructor() { this.position = new Vector(); this.up = new Vector(); this.quaternion = new Quaternion(); } updateMatrixWorld() {} }
const THREE = { WebGLRenderer: Renderer, Scene: Group, Group, Color: class {}, AmbientLight: Light, DirectionalLight: Light,
  HemisphereLight: Light, PointLight: Light, OrthographicCamera: Camera, Euler: class {}, Quaternion, Vector3: Vector,
  Plane: class {}, CanvasTexture: class { dispose() {} }, PMREMGenerator: class {
    fromEquirectangular() { conversions++; return { texture: {}, dispose() {} }; } dispose() {}
  } };
class Loader { load(_url, accept, _progress, fail) { loads.push({ accept, fail }); } }
const setup = async () => {
  Object.assign(state, { disposeScene: null, THREE, RGBELoader: Loader, assets: { hdrEnvUrl: 'inert.hdr' }, visuals: {}, layout: { style: 'stacks' },
    dom: { app: { appendChild() {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) } },
    stackPipeOwners: [], stackPacketOwner: null, shapeGeometryCache: new Map(), normalMapState: null,
    disposeControls: null, disposeResidency: null, pickIndex: null, pickFence: null,
    cancelResidentPreparation: null, cancelCameraMotion: null, onRendererStatus: null, rebuildAfterContextRestore: null, invalidateRender: null });
  const acquired = await initScene(); disposers.push(acquired.disposeScene);
  return { renderer: acquired.renderer, dispose: acquired.disposeScene,
    lost: acquired.renderer.domElement.listeners.get('webglcontextlost'), restored: acquired.renderer.domElement.listeners.get('webglcontextrestored'),
    load: loads.at(-1) };
};
try {
  globalThis.window = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 };
  globalThis.document = { createElement: () => ({ getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
  const first = await setup(); let prevented = 0, prepared = 0, cameras = 0, picking = 0, status = 0, rebuilds = 0, invalidated = 0;
  Object.assign(state, { cancelResidentPreparation() { prepared++; }, cancelCameraMotion() { cameras++; },
    pickIndex: { dispose() { picking++; } }, pickFence: { dispose() { picking++; } }, onRendererStatus() { status++; },
    rebuildAfterContextRestore() { rebuilds++; }, invalidateRender() { invalidated++; } });
  first.lost({ preventDefault() { prevented++; } });
  assert.equal(state.contextLost, true); assert.deepEqual([prevented, prepared, cameras, picking, status], [1, 1, 1, 2, 1]);
  first.restored(); assert.equal(state.contextLost, false); assert.equal(rebuilds, 1); assert.equal(invalidated, 1);
  first.dispose(); await setup(); const currentDisposer = state.disposeScene;
  Object.assign(state, { contextLost: 'sibling', cancelResidentPreparation() { assert.fail('stale loss cannot cancel sibling preparation'); },
    cancelCameraMotion() { assert.fail('stale loss cannot cancel sibling camera'); }, onRendererStatus() { assert.fail('stale listener cannot overwrite sibling status'); } });
  first.lost({ preventDefault() { assert.fail('retired listener has no current context authority'); } }); first.restored();
  assert.equal(state.contextLost, 'sibling'); assert.equal(state.disposeScene, currentDisposer);

  const replacing = await setup(); let siblingCalls = 0;
  const siblingScene = {}, siblingRenderer = {}, siblingDispose = () => {};
  state.cancelResidentPreparation = () => Object.assign(state, { scene: siblingScene, renderer: siblingRenderer, disposeScene: siblingDispose,
    contextLost: 'replacement', pickIndex: { dispose() { siblingCalls++; } }, cancelCameraMotion() { siblingCalls++; }, onRendererStatus() { siblingCalls++; } });
  replacing.lost({ preventDefault() {} }); assert.equal(siblingCalls, 0); assert.equal(state.contextLost, 'replacement');
  assert.equal(state.scene, siblingScene); assert.equal(state.disposeScene, siblingDispose);
  const staleConversions = conversions, texture = { calls: 0, dispose() { this.calls++; } };
  replacing.load.accept(texture); assert.equal(texture.calls, 1); assert.equal(conversions, staleConversions,
    'stale original loader input retires without allocating another conversion or adopting sibling status');
  texture.dispose = () => assert.fail('original captured input disposer remains selected');
  replacing.load.accept(texture); assert.equal(texture.calls, 1);

  const restoration = await setup();
  state.rebuildAfterContextRestore = () => Object.assign(state, { scene: siblingScene, renderer: siblingRenderer, disposeScene: siblingDispose,
    invalidateRender() { siblingCalls++; }, onRendererStatus() { siblingCalls++; } });
  restoration.restored(); assert.equal(siblingCalls, 0, 'reentrant restore cannot invalidate a replacement renderer');

  const loss = await setup(); let cameraAttempts = 0;
  state.cancelResidentPreparation = () => { throw undefined; };
  state.cancelCameraMotion = () => { cameraAttempts++; throw 0; };
  state.onRendererStatus = () => { throw false; };
  const lossFailure = loss.lost({ preventDefault() {} });
  assert.equal(lossFailure.cause, undefined); assert.deepEqual(lossFailure.errors, [undefined, 0, false]);
  assert.equal(cameraAttempts, 1); assert.equal(state.rendererContextFailure, lossFailure);

  const pending = await setup(); let reads = 0;
  const work = Object.freeze(Object.defineProperty(new Error('original context diagnostic native work'), 'cacheOwnershipReleased', {
    value() { assert.equal(this, work); return nativeSettled; }
  }));
  const primary = new Error('unread lazy stack'); Object.defineProperty(primary, 'message', { get() { reads++; throw work; } });
  const statusFailure = Object.freeze(new Error('independent original status failure'));
  state.rebuildAfterContextRestore = () => { throw primary; }; state.onRendererStatus = () => { throw statusFailure; };
  const failure = pending.restored();
  assert.equal(failure.cause, primary); assert.deepEqual(failure.errors, [primary, statusFailure, work]);
  assert.equal(state.rendererContextFailure, failure); assert.equal(reads, 1);
  assert.throws(() => pending.dispose()); assert.equal(pending.renderer.calls, 0, 'original callback inspection work gates actual native scene shutdown');
  nativeSettled = true;
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
  assert.equal(pending.renderer.calls, 1); assert.equal(failure.sceneOwnershipReleased(), true);

  const environment = await setup(); let environmentReads = 0;
  const environmentPrimary = new Error('unread environment lazy stack');
  Object.defineProperty(environmentPrimary, 'message', { get() { environmentReads++; throw false; } });
  const environmentFailure = environment.load.fail(environmentPrimary);
  assert.equal(environmentFailure.cause, environmentPrimary); assert.deepEqual(environmentFailure.sceneInspectionErrors, [false]);
  assert.equal(state.environmentFailure, environmentFailure); assert.equal(environmentReads, 1);
  for (const value of [undefined, null, false, 0, '']) assert.equal(environment.load.fail(value).cause, value);
  const siblingFailure = Object.freeze(new Error('current sibling environment diagnostics'));
  Object.assign(state, { scene: siblingScene, renderer: siblingRenderer, disposeScene: siblingDispose, environmentFailure: siblingFailure, environmentError: 'current sibling' });
  environment.load.fail(environmentPrimary); assert.equal(environmentReads, 1); assert.equal(state.environmentFailure, siblingFailure);
  assert.equal(state.environmentError, 'current sibling');
} finally {
  nativeSettled = true;
  for (const dispose of disposers) { try { dispose(); } catch {} }
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
  for (const key of Object.keys(state)) if (!Object.hasOwn(originalState, key)) delete state[key];
  Object.assign(state, originalState); globalThis.window = originalWindow; globalThis.document = originalDocument;
}
console.log('Actual context/HDR callback original scene/diagnostic/prerequisite controls authored; execution deferred.');
