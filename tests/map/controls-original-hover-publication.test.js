import assert from 'node:assert/strict';
import { initControls } from '../../src/map/isometric/client/controls.js';
import { state } from '../../src/map/isometric/client/state.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual controls, hover, render loop and input owners. Every DOM/Three/RAF/
// renderer boundary is an inert original object; no browser or GPU is created.
class Surface {
  events = new Map();
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); }
  removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
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
const disposers = [];
const create = () => {
  for (const key of Reflect.ownKeys(state)) delete state[key];
  const value = { renders: [], callbacks: new Map(), next: 1 }, canvas = new Surface(), app = new Surface();
  const window = new Surface(), document = new Surface(); document.activeElement = app; document.hidden = false;
  window.matchMedia = () => Object.assign(new Surface(), { matches: false }); window.devicePixelRatio = 1;
  class Raycaster {
    ray = { intersectPlane: () => false };
    setFromCamera() {}
    intersectObjects() { value.onPick?.(); return []; }
  }
  const renderer = { domElement: canvas, info: null, setPixelRatio() {}, setSize() {},
    render(scene, camera) { value.renders.push({ scene, camera }); value.onRender?.(); } };
  const camera = { left: -1, right: 1, top: 1, bottom: -1, zoom: 1, position: { x: 0, z: 0 },
    matrixWorld: new Matrix4(), projectionMatrix: new Matrix4(), matrixWorldInverse: new Matrix4(),
    updateProjectionMatrix() {}, updateMatrixWorld() { value.onCamera?.(); } };
  Object.assign(state, { THREE: { Vector2, Raycaster, Frustum, Matrix4 }, renderer, camera, scene: {}, dom: { app },
    getViewport: () => ({ width: 640, height: 480 }), lockIsometric() {}, groundPlane: {}, lineResolution: {}, cameraBase: 1,
    nearPlane: 0.1, farPlane: 100, layoutStyle: 'legacy', controls: {},
    controlDefaults: { wasd: { acceleration: 1, maxSpeed: 1, drag: 1, sensitivity: 1 }, zoomMin: 0.1, zoomMax: 10 },
    flowWaveLayers: [], flowWaveTotal: 1, visuals: { glowPulseSpeed: 0, wirePulseSpeed: 0, gridPulseSpeed: 0, pixelRatioCap: 1 },
    visualDefaults: { glowPulseSpeed: 0, wirePulseSpeed: 0, gridPulseSpeed: 0, pixelRatioCap: 1 },
    glowMaterials: [], flowMaterials: [], flowLights: [], wireMaterials: [], gridLineMaterials: [],
    fileGroup: { visible: false }, memberGroup: { visible: false }, edgeGroup: { visible: false }, wireGroup: { visible: false },
    gridLines: { visible: false }, performance: {}, hovered: null });
  globalThis.window = window; globalThis.document = document;
  globalThis.requestAnimationFrame = callback => { const id = value.next++; value.callbacks.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => { value.callbacks.delete(id); };
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
  const duringPick = create(); duringPick.pointer(); duringPick.onPick = duringPick.replace; duringPick.frame();
  assert.equal(duringPick.renders.length, 0); assert.equal(state.hovered, 'sibling hover');
  assert.equal(state.perfStats, duringPick.sibling.perfStats, 'old hover return cannot overwrite sibling telemetry or submit sibling scene'); duringPick.dispose();
  assert.equal(state.hovered, 'sibling hover', 'old hover retirement must not clear a sibling controls owner');
  const duringCamera = create(); duringCamera.onCamera = duringCamera.replace; duringCamera.frame();
  assert.equal(duringCamera.renders.length, 0); assert.equal(state.cameraRevision, 100); duringCamera.dispose();
  const duringRender = create(); duringRender.onRender = duringRender.replace; duringRender.frame();
  assert.equal(duringRender.renders.length, 1, 'already accepted native render remains an original submission');
  assert.equal(state.perfStats, duringRender.sibling.perfStats); assert.equal(state.perfStats.renderer, 'sibling metrics'); duringRender.dispose();
} finally {
  for (const dispose of disposers) { try { dispose(); } catch {} }
  for (const owner of getPendingSceneResourceOwners()) if (!baseline.has(owner)) { try { await owner.releaseAsync(); } catch {} }
  for (const key of Reflect.ownKeys(state)) delete state[key]; Object.defineProperties(state, originalState);
  for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}
console.log('Actual controls original hover/camera/render publication fences authored; execution deferred.');
