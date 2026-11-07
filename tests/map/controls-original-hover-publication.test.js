import assert from 'node:assert/strict';
import { initControls } from '../../src/map/isometric/client/controls.js';
import { state } from '../../src/map/isometric/client/state.js';
import { getPendingSceneResourceOwners, captureSceneResource } from '../../src/map/isometric/client/scene-retirement.js';
import { createSceneDisposerGuard } from '../../src/map/isometric/client/rendering/scene-disposer-guard.js';

// Actual controls, hover, render loop and input owners. Every DOM/Three/RAF/
// renderer boundary is an inert original object; no browser or GPU is created.
class Surface {
  events = new Map();
  added = 0; removed = 0;
  addEventListener(name, callback) { this.added++; if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); this.onAdd?.(name, callback); }
  removeEventListener(name, callback) { this.removed++; this.events.get(name)?.delete(callback); this.onRemove?.(name, callback); }
  fire(name, event = {}) { event.target ??= this; for (const callback of [...this.events.get(name) || []]) callback(event); }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
}
class Vector2 {
  constructor(x = 0, y = 0) { this.set(x, y); }
  set(x, y) { this.x = x; this.y = y; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y; }
}
class Matrix4 {
  elements = new Array(16).fill(0);
  makeScale() { return this; }
  multiplyMatrices() { return this; }
}
class Frustum { setFromProjectionMatrix() {} intersectsSphere() { return true; } }
const globalNames = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];
const globals = new Map(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const originalState = Object.getOwnPropertyDescriptors(state), baseline = new Set(getPendingSceneResourceOwners());
const disposers = [], finishes = [];
const caught = invoke => { try { invoke(); } catch (error) { return error; } assert.fail('expected retained actual controls failure'); };
const create = (configure = () => {}) => {
  for (const key of Reflect.ownKeys(state)) delete state[key];
  const value = { renders: [], callbacks: new Map(), cancellations: [], stages: [], next: 1 }, canvas = new Surface(), app = new Surface();
  const window = new Surface(), document = new Surface(); document.activeElement = app; document.hidden = false;
  const media = Object.assign(new Surface(), { matches: false });
  window.matchMedia = () => media; window.devicePixelRatio = 1;
  class Raycaster {
    ray = { intersectPlane: () => false };
    setFromCamera() {}
    intersectObjects() { value.onPick?.(); return []; }
  }
  const renderer = { domElement: canvas, info: null,
    setPixelRatio() { assert.equal(this, renderer); value.stages.push('pixel'); value.onPixel?.(); },
    setSize() { assert.equal(this, renderer); value.stages.push('size'); value.onSize?.(); },
    render(scene, camera) { assert.equal(this, renderer); value.renders.push({ scene, camera }); value.onRender?.(); } };
  const camera = { left: -1, right: 1, top: 1, bottom: -1, zoom: 1, position: { x: 0, z: 0 },
    matrixWorld: new Matrix4(), projectionMatrix: new Matrix4(), matrixWorldInverse: new Matrix4(),
    updateProjectionMatrix() { assert.equal(this, camera); value.stages.push('projection'); value.onProjection?.(); },
    updateMatrixWorld() { assert.equal(this, camera); value.onCamera?.(); } };
  Object.assign(state, { THREE: { Vector2, Raycaster, Frustum, Matrix4 }, renderer, camera, scene: {}, dom: { app },
    getViewport: () => { value.stages.push('viewport'); value.onViewport?.(); return { width: 640, height: 480 }; },
    lockIsometric() { value.stages.push('lock'); value.onLock?.(); }, groundPlane: {}, lineResolution: {}, cameraBase: 1,
    nearPlane: 0.1, farPlane: 100, layoutStyle: 'legacy', controls: {},
    controlDefaults: { wasd: { acceleration: 1, maxSpeed: 1, drag: 1, sensitivity: 1 }, zoomMin: 0.1, zoomMax: 10 },
    flowWaveLayers: [], flowWaveTotal: 1, visuals: { glowPulseSpeed: 0, wirePulseSpeed: 0, gridPulseSpeed: 0, pixelRatioCap: 1 },
    visualDefaults: { glowPulseSpeed: 0, wirePulseSpeed: 0, gridPulseSpeed: 0, pixelRatioCap: 1 },
    glowMaterials: [], flowMaterials: [], flowLights: [], wireMaterials: [], gridLineMaterials: [],
    fileGroup: { visible: false }, memberGroup: { visible: false }, edgeGroup: { visible: false }, wireGroup: { visible: false },
    gridLines: { visible: false }, performance: {}, hovered: null });
  globalThis.window = window; globalThis.document = document;
  globalThis.requestAnimationFrame = callback => { const id = value.next++; value.callbacks.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => { value.cancellations.push(id); value.onCancel?.(id); value.callbacks.delete(id); };
  Object.assign(value, { state, renderer, camera, canvas, app, window, document, media }); configure(value);
  initControls(); const dispose = state.disposeControls; disposers.push(dispose);
  value.frame = () => { const [id, callback] = value.callbacks.entries().next().value; value.callbacks.delete(id); callback(100); };
  value.pointer = () => canvas.fire('pointermove', { clientX: 20, clientY: 30 });
  value.replace = () => {
    value.sibling = { disposeControls() {}, renderer: {}, scene: {}, hovered: 'sibling hover', perfStats: { renderer: 'sibling metrics' }, cameraRevision: 100 };
    Object.assign(state, value.sibling);
  };
  value.dispose = dispose; return value;
};
try {
  const normal = create(); normal.frame(); assert.equal(normal.renders.length, 1); assert.equal(normal.callbacks.size, 0); normal.dispose();
  const immutableCallbacks = create();
  immutableCallbacks.renderer.render = immutableCallbacks.renderer.setSize = immutableCallbacks.renderer.setPixelRatio
    = immutableCallbacks.camera.updateMatrixWorld = immutableCallbacks.camera.updateProjectionMatrix
    = () => assert.fail('later renderer/camera methods are not original callback authority');
  immutableCallbacks.window.fire('resize'); immutableCallbacks.frame(); assert.equal(immutableCallbacks.renders.length, 1); immutableCallbacks.dispose();

  const stages = ['viewport', 'projection', 'pixel', 'size', 'lock'];
  for (const [index, stage] of stages.entries()) {
    const staleResize = create(), before = staleResize.stages.length;
    staleResize[`on${stage[0].toUpperCase()}${stage.slice(1)}`] = staleResize.replace;
    staleResize.window.fire('resize'); assert.deepEqual(staleResize.stages.slice(before), stages.slice(0, index + 1));
    staleResize.frame(); assert.equal(staleResize.renders.length, 0); staleResize.dispose(); assert.equal(state.hovered, 'sibling hover');
  }
  for (const group of ['wireMaterials', 'gridLineMaterials']) {
    const resizedMaterials = create(value => { value.state[group] = [
      { resolution: { set() { value.materialCalls = (value.materialCalls || 0) + 1; value.onMaterial?.(); } } },
      { resolution: { set() { value.secondMaterialCalls = (value.secondMaterialCalls || 0) + 1; } } }
    ]; });
    const before = resizedMaterials.secondMaterialCalls;
    resizedMaterials.onMaterial = resizedMaterials.replace; resizedMaterials.window.fire('resize');
    assert.equal(resizedMaterials.secondMaterialCalls, before, 'old resize cannot continue native material callbacks after original ownership is revoked');
    resizedMaterials.dispose(); assert.equal(state.hovered, 'sibling hover');
  }

  for (const method of ['render', 'setPixelRatio', 'setSize']) {
    let reads = 0, partial;
    const original = Object.freeze(new Error(`original native ${method} capture`));
    const failedCapture = caught(() => create(value => { partial = value; Object.defineProperty(value.renderer, method, { get() { reads++; throw original; } }); }));
    assert.equal(failedCapture.cause, original); assert.equal(reads, 1); assert.equal(state.disposeControls, null);
    assert.equal(partial.callbacks.size, 0); assert.equal(partial.renders.length, 0);
  }
  const callbackNames = ['render', 'setPixelRatio', 'setSize', 'updateMatrixWorld', 'updateProjectionMatrix'];
  for (const [stop, name] of callbackNames.entries()) for (const mode of ['dispose', 'replace']) {
    const reads = []; let originalStack, during, replacement;
    const failedCapture = caught(() => create(value => {
      value.state.THREE.Vector2 = class { constructor() { assert.fail('revoked callback capture cannot continue controls construction'); } };
      for (const method of callbackNames) {
        const resource = method.startsWith('update') ? value.camera : value.renderer, original = resource[method];
        Object.defineProperty(resource, method, { get() {
          reads.push(method);
          if (method === name) {
            if (mode === 'dispose') { originalStack = caught(value.state.disposeControls); during = originalStack.sceneOwnershipReleased(); }
            else { replacement = () => {}; value.state.disposeControls = replacement; }
          }
          return original;
        } });
      }
    }));
    assert.match(failedCapture.cause.message, /runtime callback capture/); assert.deepEqual(reads, callbackNames.slice(0, stop + 1),
      'revocation during any original getter must prevent every later renderer/camera getter');
    if (mode === 'dispose') { assert.equal(during, false); assert.equal(originalStack.sceneOwnershipReleased(), true); assert.equal(state.disposeControls, null); }
    else assert.equal(state.disposeControls, replacement, 'old capture cleanup cannot detach a replacement publication');
  }
  let nativeReady = false, nativeReads = 0, nativeClosed = 0, originalScene;
  finishes.push(() => { nativeReady = true; });
  const nativeWork = Object.freeze(Object.defineProperty(new Error('original pending native callback capture'), 'cacheOwnershipReleased', { value: () => nativeReady }));
  const nativeCaptureFailure = caught(() => create(value => {
    const scene = captureSceneResource({ dispose() { nativeClosed++; } }, 'controls fixture pending native scene');
    originalScene = createSceneDisposerGuard({ receiver: value.state, dispose: scene.retire, beforeDispose: scene.assertReady, retainFailure: scene.retainFailure });
    value.state.disposeScene = originalScene;
    Object.defineProperty(value.renderer, 'render', { get() { nativeReads++; throw nativeWork; } });
  }));
  assert.equal(nativeCaptureFailure.cause, nativeWork); caught(originalScene); assert.equal(nativeClosed, 0); assert.equal(nativeReads, 1);
  nativeReady = true;
  for (const label of ['original controls resident picking', 'original controls lifetime']) {
    getPendingSceneResourceOwners().find(owner => !baseline.has(owner) && owner.label === label).release();
  }
  originalScene(); assert.equal(nativeClosed, 1); assert.equal(nativeReads, 1);
  let partialInput, replacementInputDispose;
  const inputConstructionFailure = caught(() => create(value => {
    partialInput = value;
    value.document.onAdd = name => {
      if (name === 'focusin') { replacementInputDispose = () => {}; value.state.disposeControls = replacementInputDispose; }
    };
  }));
  assert.match(inputConstructionFailure.cause.cause.message, /input construction lost/);
  assert.equal(partialInput.document.added, 1); assert.equal(partialInput.app.added, 1);
  assert.equal(partialInput.callbacks.size, 0); assert.equal(state.disposeControls, replacementInputDispose);
  for (const surface of [partialInput.canvas, partialInput.app, partialInput.window, partialInput.document]) {
    assert.equal(surface.added, surface.removed, 'actual initControls stops input construction and independently removes original partial subscriptions');
  }
  let partialListener, replacementListenerDispose; const listenerReads = [];
  caught(() => create(value => {
    partialListener = value;
    Object.defineProperty(value.canvas, 'addEventListener', { get() {
      listenerReads.push('add'); replacementListenerDispose = () => {}; value.state.disposeControls = replacementListenerDispose;
      return Surface.prototype.addEventListener;
    } });
    Object.defineProperty(value.canvas, 'removeEventListener', { get() { listenerReads.push('remove'); return Surface.prototype.removeEventListener; } });
  }));
  assert.deepEqual(listenerReads, ['add']); assert.equal(partialListener.canvas.added, 0); assert.equal(partialListener.canvas.removed, 0);
  assert.equal(state.disposeControls, replacementListenerDispose); assert.equal(partialListener.callbacks.size, 0);

  const duringPick = create(); duringPick.pointer(); duringPick.onPick = duringPick.replace; duringPick.frame();
  assert.equal(duringPick.renders.length, 0); assert.equal(state.hovered, 'sibling hover');
  assert.equal(state.perfStats, duringPick.sibling.perfStats, 'old hover return cannot overwrite sibling telemetry or submit sibling scene'); duringPick.dispose();
  assert.equal(state.hovered, 'sibling hover', 'old hover retirement must not clear a sibling controls owner');
  const duringCamera = create(); duringCamera.onCamera = duringCamera.replace; duringCamera.frame();
  assert.equal(duringCamera.renders.length, 0); assert.equal(state.cameraRevision, 100); duringCamera.dispose();
  const duringRender = create(); duringRender.onRender = duringRender.replace; duringRender.frame();
  assert.equal(duringRender.renders.length, 1, 'already accepted native render remains an original submission');
  assert.equal(state.perfStats, duringRender.sibling.perfStats); assert.equal(state.perfStats.renderer, 'sibling metrics'); duringRender.dispose();

  let accepting = false; finishes.push(() => { accepting = true; });
  const cancelFailure = Object.freeze(new Error('actual original RAF cancel failed'));
  const failedCleanup = create(value => { value.onCancel = () => { if (!accepting) throw cancelFailure; }; });
  const cleanupFailure = caught(failedCleanup.dispose); assert.equal(failedCleanup.cancellations.length, 1);
  const surfaces = [failedCleanup.canvas, failedCleanup.app, failedCleanup.window, failedCleanup.document, failedCleanup.media];
  assert(surfaces.every(surface => [...surface.events.values()].every(callbacks => callbacks.size === 0)),
    'failed native RAF cancellation cannot skip any independent input or outer listener removal');
  assert(surfaces.every(surface => surface.added === surface.removed)); assert.equal(state.disposeControls, null);
  assert.equal(state.invalidateRender, null); assert.equal(state.invalidateHover, null); assert.equal(state.cancelCameraMotion, null);
  caught(failedCleanup.dispose); assert.equal(failedCleanup.cancellations.length, 1, 'ordinary disposal does not repeat a failed native cancel');
  accepting = true;
  for (const label of ['original RAF request', 'original render loop', 'original controls frame loop', 'original controls lifetime']) {
    getPendingSceneResourceOwners().find(owner => !baseline.has(owner) && owner.label === label).release();
  }
  assert.equal(failedCleanup.cancellations.length, 2); assert.equal(cleanupFailure.sceneOwnershipReleased(), true);
  assert(surfaces.every(surface => surface.added === surface.removed), 'fulfilled listener removals are not repeated during exact reconciliation');

  for (const primary of [undefined, false, 0]) {
    let partial;
    const failure = caught(() => create(value => { partial = value; value.renderer.setSize = () => { throw primary; }; }));
    assert.equal(failure.cause, primary); assert.equal(state.disposeControls, null);
    assert([partial.canvas, partial.app, partial.window, partial.document, partial.media]
      .every(surface => surface.added === surface.removed && [...surface.events.values()].every(callbacks => callbacks.size === 0)),
    'actual late construction failure retires every acquired original input/listener');
    assert.equal(partial.callbacks.size, 0);
  }
  let installed;
  const registrationFailure = caught(() => create(value => { installed = value; value.window.onAdd = name => { if (name === 'resize') throw null; }; }));
  assert.equal(registrationFailure.cause, null); assert.equal(state.disposeControls, null);
  assert([installed.canvas, installed.app, installed.window, installed.document, installed.media].every(surface => surface.added === surface.removed));

  for (const field of ['invalidateHover', 'invalidateRender']) {
    let installedValue, issued;
    const original = Object.freeze(new Error(`original initial ${field} publication`));
    const publicationFailure = caught(() => create(value => {
      Object.defineProperty(value.state, field, { configurable: true, get() { return installedValue; }, set(next) {
        installedValue = next; if (typeof next === 'function') { issued = next; throw original; }
      } });
    }));
    assert.equal(publicationFailure.cause, original); assert.equal(installedValue, null); assert.equal(state.disposeControls, null);
    assert.equal(typeof issued, 'function'); assert.equal(issued(), undefined, 'installed-then-thrown original publication remains revoked');
    if (field === 'invalidateRender') assert.equal(state.invalidateHover, null, 'earlier initial publication is independently detached');
  }
  for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original initial disposer publication'))]) {
    let installedValue, issued;
    const publicationFailure = caught(() => create(value => {
      Object.defineProperty(value.state, 'disposeControls', { configurable: true, get() { return installedValue; }, set(next) {
        installedValue = next; if (typeof next === 'function') { issued = next; throw primary; }
      } });
    }));
    assert.equal(publicationFailure.cause, primary); assert.equal(installedValue, null); assert.equal(typeof issued, 'function');
    assert.equal(issued().pending, false, 'failed initial disposer publication preserves its exact revoked closed capability');
  }
  for (const throwsAfterRetirement of [false, true]) {
    let installedValue, reentrant, issued, during;
    const original = Object.freeze(new Error('original post-retirement publication failure'));
    const publicationFailure = caught(() => create(value => {
      Object.defineProperty(value.state, 'disposeControls', { configurable: true, get() { return installedValue; }, set(next) {
        installedValue = next;
        if (typeof next === 'function') {
          issued = next; reentrant = caught(next); during = reentrant.sceneOwnershipReleased();
          if (throwsAfterRetirement) throw original;
        }
      } });
    }));
    assert.equal(during, false); assert.equal(reentrant.sceneOwnershipReleased(), true); assert.equal(installedValue, null);
    if (throwsAfterRetirement) assert.equal(publicationFailure.cause, original);
    else assert.match(publicationFailure.cause.message, /initial disposer publication/);
    assert.equal(issued().pending, false, 'reentrant original disposal cannot close while its publication stack is accepted');
  }
} finally {
  for (const finish of finishes) finish();
  for (const dispose of disposers) { try { dispose(); } catch {} }
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
  for (const key of Reflect.ownKeys(state)) delete state[key]; Object.defineProperties(state, originalState);
  for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
console.log('Actual controls original hover/camera/render publication fences authored; execution deferred.');
