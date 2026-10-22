import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { initScene } from '../../src/map/isometric/client/scene.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';
import { createRendererEnhancementOwner } from '../../src/map/isometric/client/rendering/enhancement-owner.js';
import { createNormalMapOwner } from '../../src/map/isometric/client/normal-map-owner.js';

// Actual initScene/disposeScene with inert constructors, no DOM host or Three.
const originalState = { ...state }, originalWindow = globalThis.window, originalDocument = globalThis.document;
const nativeFailure = Object.freeze(new Error('controlled frozen renderer/child cleanup'));
const resources = [], renderers = [], targets = [];
let refusing = true;
let finishConstruction = null;
const resource = (label, fail = false) => {
  const value = { label, calls: 0, dispose() { this.calls++; if (fail && refusing) throw nativeFailure; } };
  resources.push(value); return value;
};
class Vector { set() { return this; } copy() { return this; } }
class Quaternion extends Vector { setFromEuler() { return this; } }
class Group {
  constructor() { this.children = []; this.userData = {}; }
  add(child) { this.children.push(child); }
  remove(child) { this.children.splice(this.children.indexOf(child), 1); }
  traverse(visitor) { visitor(this); for (const child of [...this.children]) {
    if (child.traverse) child.traverse(visitor); else visitor(child);
  } }
}
class Light {
  constructor() {
    this.position = new Vector(); this.shadow = Object.assign(resource('light shadow', true), { mapSize: new Vector(), camera: {} });
  }
}
class Renderer {
  constructor() {
    this.shadowMap = {}; this.calls = 0;
    this.domElement = { style: {}, removed: 0, addEventListener() {}, removeEventListener() {}, remove() { this.removed++; } };
    renderers.push(this);
  }
  setPixelRatio() {} setSize() {}
  dispose() { this.calls++; if (refusing) throw nativeFailure; }
}
class Camera {
  constructor() { this.position = new Vector(); this.up = new Vector(); this.quaternion = new Quaternion(); }
  updateMatrixWorld() {}
}
const THREE = { WebGLRenderer: Renderer, Scene: Group, Group, Color: class {},
  AmbientLight: Light, DirectionalLight: Light, HemisphereLight: Light, PointLight: Light,
  OrthographicCamera: Camera, Euler: class {}, Quaternion, Vector3: Vector, Plane: class {},
  CanvasTexture: class { constructor() { Object.assign(this, resource('fallback input')); } },
  PMREMGenerator: class {
    fromEquirectangular() { const target = Object.assign(resource('PMREM target'), { texture: {} }); targets.push(target); return target; }
    dispose() {}
  } };
const app = { appendChild() {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
const setup = () => Object.assign(state, { disposeScene: null, THREE, dom: { app }, RGBELoader: null,
  assets: {}, visuals: {}, layout: { style: 'stacks' }, stackPipeOwners: [], stackPacketOwner: null,
  shapeGeometryCache: new Map(), normalMapState: null, disposeControls: null, disposeResidency: null });
const expectFailure = invoke => { try { invoke(); assert.fail('expected retained scene cleanup'); }
  catch (error) { assert.equal(error.sceneOwnershipPending, true); return error; } };
try {
  globalThis.window = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 };
  globalThis.document = { createElement: () => ({ getContext: () => ({
    createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}
  }) }) };
  setup(); await initScene();
  const renderer = renderers[0], disposal = state.disposeScene;
  renderer.dispose = () => assert.fail('renderer close uses the originally acquired method');
  const control = resource('controls', true), residency = resource('residency'), pipe = resource('pipe', true);
  state.disposeControls = control.dispose.bind(control); state.disposeResidency = residency.dispose.bind(residency);
  state.stackPipeOwners = [pipe]; state.stackPacketOwner = pipe;
  const shape = resource('shared shape', true), normal = resource('normal map', true);
  state.shapeGeometryCache = new Map([['first', shape], ['alias', shape]]); state.normalMapState = { texture: normal };
  const failure = expectFailure(disposal);
  assert.equal(state.sceneRetirementFailure, failure); assert.equal(renderer.calls, 1); assert.equal(renderer.domElement.removed, 1);
  assert.equal(control.calls, 1); assert.equal(residency.calls, 1); assert.equal(pipe.calls, 1);
  assert.equal(shape.calls, 1); assert.equal(normal.calls, 1); assert.equal(targets[0].calls, 1);
  assert.equal(state.stackPipeOwners.length, 0); assert.equal(state.shapeGeometryCache.size, 0); assert.equal(state.normalMapState.texture, null);
  assert.equal(expectFailure(disposal), failure); assert.equal(renderer.calls, 1, 'repeated shutdown does not automatically retry failed native closes');
  assert.ok(state.sceneRetirementOwners.some(owner => owner.resource === renderer));
  refusing = false;
  for (const owner of failure.sceneResourceOwners) owner.release();
  assert.equal(failure.sceneOwnershipReleased(), true); disposal();
  assert.equal(state.disposeScene, null); assert.equal(renderer.calls, 2); assert.equal(renderer.domElement.removed, 1);
  assert.equal(residency.calls, 1); assert.equal(targets[0].calls, 1);

  // A stale scene closure only retires its original local renderer/scene. It
  // cannot adopt controls, cache geometry or normal maps from another scene.
  setup(); await initScene();
  const old = state.disposeScene, oldRenderer = renderers[1];
  const siblingControl = resource('sibling controls'), siblingShape = resource('sibling shape'), siblingNormal = resource('sibling normal');
  const siblingScene = new Group(), siblingDispose = () => {};
  Object.assign(state, { scene: siblingScene, disposeScene: siblingDispose, disposeControls: siblingControl.dispose.bind(siblingControl),
    shapeGeometryCache: new Map([['sibling', siblingShape]]), normalMapState: { texture: siblingNormal } });
  old(); assert.equal(oldRenderer.calls, 1); assert.equal(state.disposeScene, siblingDispose);
  assert.equal(siblingControl.calls, 0); assert.equal(siblingShape.calls, 0); assert.equal(siblingNormal.calls, 0);

  // Actual scene producer through enhancement ownership: a delayed older
  // initializer rejection cannot dispose a newer successfully published scene.
  setup();
  let constructed, rejectConstruction, constructions=0;
  const constructionEntered=new Promise(resolve=>{constructed=resolve;});
  const constructionGate=new Promise((resolve,reject)=>{finishConstruction=resolve;rejectConstruction=reject;});
  const summary={textContent:'',append(){}},retry={remove(){}};
  const enhancement=createRendererEnhancementOwner({state,summary,retry,
    loadModules:async()=>({THREE}),loadEnvironment:async()=>null,
    construct:async options=>{const acquired=await initScene(options);if(constructions++===0){constructed();await constructionGate;}return acquired;},
    initialize(){},renderSummary(){summary.textContent='current scene accepted';}});
  const olderEnhancement=enhancement.enhance();await constructionEntered;const previousRenderer=state.renderer;
  assert.equal((await enhancement.enhance()).ok,true);const currentRenderer=state.renderer,currentDisposer=state.disposeScene;
  assert.notEqual(currentRenderer,previousRenderer);assert.equal(previousRenderer.calls,1);assert.equal(currentRenderer.calls,0);
  rejectConstruction(nativeFailure);const olderResult=await olderEnhancement;
  assert.equal(olderResult.reason,'superseded');assert.equal(olderResult.error.cause,nativeFailure);
  assert.equal(state.renderer,currentRenderer);assert.equal(state.disposeScene,currentDisposer);assert.equal(currentRenderer.calls,0);
  assert.equal(previousRenderer.calls,1);assert.equal(state.rendererFailure,null);assert.equal(summary.textContent,'current scene accepted');
  currentDisposer();enhancement.dispose();

  // A current post-construction failure retains the original scene owner. A
  // deliberate enhancement retry reports its pending cleanup without repeating
  // renderer/light native closes or constructing a replacement first.
  setup();refusing=true;
  const failingEnhancement=createRendererEnhancementOwner({state,summary,retry,
    loadModules:async()=>({THREE}),loadEnvironment:async()=>null,construct:initScene,
    initialize(){throw nativeFailure;},renderSummary(){assert.fail('failed scene is not accepted');}});
  const failedEnhancement=await failingEnhancement.enhance(),failedRenderer=state.renderer,rendererCount=renderers.length;
  assert.equal(failedEnhancement.reason,'failed');assert.equal(failedEnhancement.error.cause,nativeFailure);
  assert.equal(failedEnhancement.error.sceneOwnershipPending,true);assert.equal(failedRenderer.calls,1);
  assert.equal(state.rendererCapabilities.backend,'source-only');assert.equal(state.rendererFailure,failedEnhancement.error);
  assert.ok(getPendingSceneResourceOwners().some(owner=>owner.resource===failedRenderer));
  const failedRetry=await failingEnhancement.enhance();
  assert.equal(failedRetry.ok,false);assert.equal(failedRenderer.calls,1);assert.equal(renderers.length,rendererCount);
  refusing=false;
  for(const owner of getPendingSceneResourceOwners())try{owner.release();}catch{}
  assert.equal(failedEnhancement.error.sceneOwnershipReleased(),true);assert.equal(failedRenderer.calls,2);
  failingEnhancement.dispose();

  // Actual shutdown retires the loader's captured returned texture even before
  // its completion callback, without looking up a replaced texture disposer.
  setup(); await initScene();
  const originalScene=state.scene,uncompletedNormal=resource('uncompleted captured normal');
  const normalOwner=createNormalMapOwner({isCurrent:()=>state.scene===originalScene,configure(){}});
  normalOwner.track(uncompletedNormal);state.normalMapState=normalOwner;
  uncompletedNormal.dispose=()=>assert.fail('normal-map shutdown retains the original loader-return disposer');
  state.disposeScene();assert.equal(uncompletedNormal.calls,1);assert.equal(normalOwner.texture,null);
  assert.equal(state.disposeScene,null);
} finally {
  refusing = false;
  finishConstruction?.();
  for (const owner of getPendingSceneResourceOwners()) { try { owner.release(); } catch {} }
  for (const key of Object.keys(state)) if (!Object.hasOwn(originalState, key)) delete state[key];
  Object.assign(state, originalState); globalThis.window = originalWindow; globalThis.document = originalDocument;
}
console.log('Actual scene shutdown exact failure/sibling ownership controls authored; all execution deferred.');
