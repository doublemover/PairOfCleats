import assert from 'node:assert/strict';
import { state } from '../../src/map/isometric/client/state.js';
import { initScene } from '../../src/map/isometric/client/scene.js';
import { createRendererEnhancementOwner } from '../../src/map/isometric/client/rendering/enhancement-owner.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual scene construction with inert objects and controlled constructor steps.
const originalState={...state},originalWindow=globalThis.window,originalDocument=globalThis.document;
const primary=Object.freeze(new AggregateError([new Error('original construction leaf')],'original construction failure'));
const cleanup=Object.freeze(new Error('original construction cleanup'));
const renderers=[],shadows=[];let phase='',thrown=primary,refusing=false,releaseNative=null;
const fail=step=>{if(phase===step)throw thrown;};
class Vector{set(){fail('light-position');return this;}copy(){return this;}}
class Quaternion extends Vector{setFromEuler(){return this;}}
class Group{
  constructor(){this.children=[];this.userData={};}
  add(child){this.children.push(child);}
  remove(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);}
  traverse(visit){visit(this);for(const child of [...this.children]){if(child.traverse)child.traverse(visit);else visit(child);}}
}
class Light{
  constructor(){this.position=new Vector();this.shadow={calls:0,mapSize:new Vector(),camera:{},dispose(){this.calls++;if(refusing)throw cleanup;}};shadows.push(this.shadow);}
}
class Renderer{
  constructor(){
    this.calls=0;this.shadowMap={};
    this.domElement={style:{},removed:0,registered:[],unregistered:[],
      addEventListener(event,callback){this.registered.push([event,callback]);if(event==='webglcontextrestored')fail('listener');},
      removeEventListener(event,callback){this.unregistered.push([event,callback]);},
      remove(){this.removed++;if(refusing)throw cleanup;}};
    renderers.push(this);
  }
  setPixelRatio(){fail('pixel-ratio');}setSize(){}
  dispose(){this.calls++;if(refusing)throw cleanup;}
}
class Camera{constructor(){this.position=new Vector();this.up=new Vector();this.quaternion=new Quaternion();}updateMatrixWorld(){}}
const THREE={WebGLRenderer:Renderer,Scene:Group,Group,Color:class{constructor(){fail('color');}},
  AmbientLight:Light,DirectionalLight:Light,HemisphereLight:Light,PointLight:Light,OrthographicCamera:Camera,
  Euler:class{},Quaternion,Vector3:Vector,Plane:class{},CanvasTexture:class{dispose(){}},
  PMREMGenerator:class{fromEquirectangular(){return {texture:{},dispose(){}};}dispose(){}}};
const app={appendChild(){},getBoundingClientRect:()=>({width:800,height:600})};
const setup=()=>Object.assign(state,{disposeScene:null,THREE,dom:{app},RGBELoader:null,assets:{},visuals:{},layout:{style:'stacks'},
  stackPipeOwners:[],stackPacketOwner:null,shapeGeometryCache:new Map(),normalMapState:null,disposeControls:null,disposeResidency:null});
const rejected=work=>work.then(()=>assert.fail('expected original construction failure'),error=>error);
try{
  globalThis.window={innerWidth:800,innerHeight:600,devicePixelRatio:1};
  globalThis.document={createElement(){fail('after-install');return {getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),fillRect(){}})};}};
  for(const value of [primary,undefined,null,false,0,'']){
    setup();phase='pixel-ratio';thrown=value;refusing=false;
    const priorScene={},priorRenderer={};let siblingCloses=0;
    Object.assign(state,{scene:priorScene,renderer:priorRenderer,disposeControls:()=>{siblingCloses++;}});
    const failure=await rejected(initScene()),renderer=renderers.at(-1);
    assert.equal(failure.cause,value);assert.deepEqual(failure.errors,[value]);assert.equal(renderer.calls,1);assert.equal(renderer.domElement.removed,1);
    assert.equal(state.scene,priorScene);assert.equal(state.renderer,priorRenderer);assert.equal(siblingCloses,0);
  }

  setup();phase='pixel-ratio';thrown=primary;refusing=true;
  const cleanupFailure=await rejected(initScene()),failedRenderer=renderers.at(-1);
  assert.equal(cleanupFailure.cause,primary);assert.equal(cleanupFailure.sceneOwnershipPending,true);
  assert.equal(failedRenderer.calls,1);assert.equal(failedRenderer.domElement.removed,1);
  failedRenderer.dispose=()=>assert.fail('keep originally captured construction renderer disposer');
  refusing=false;
  for(const owner of getPendingSceneResourceOwners())try{owner.release();}catch{}
  assert.equal(cleanupFailure.sceneOwnershipReleased(),true);assert.equal(failedRenderer.calls,2);assert.equal(failedRenderer.domElement.removed,2);

  setup();phase='light-position';thrown=primary;const shadowStart=shadows.length;
  const lightFailure=await rejected(initScene());assert.equal(lightFailure.cause,primary);
  assert.deepEqual(shadows.slice(shadowStart).map(shadow=>shadow.calls),[1,1],'returned unattached light shadow is still construction-owned');

  setup();phase='listener';thrown=primary;
  const listenerFailure=await rejected(initScene()),listenerRenderer=renderers.at(-1);
  assert.equal(listenerFailure.cause,primary);assert.equal(listenerRenderer.calls,1);assert.equal(listenerRenderer.domElement.removed,1);
  assert.deepEqual(listenerRenderer.domElement.unregistered,[...listenerRenderer.domElement.registered].reverse(),
    'both possibly admitted original listener callbacks are independently removed');

  setup();phase='';const initialShadowStart=shadows.length;
  await initScene();const initialShadows=shadows.slice(initialShadowStart),lights=state.scene.children.filter(child=>child.shadow);
  state.scene.remove(lights[0]);
  initialShadows[0].dispose=()=>assert.fail('detached initial shadow keeps its captured method');
  const replacementShadow={calls:0,dispose(){this.calls++;}};lights[1].shadow=replacementShadow;
  state.disposeScene();assert.deepEqual(initialShadows.map(shadow=>shadow.calls),[1,1,1,1,1,1,1]);
  assert.equal(replacementShadow.calls,1,'replacement cannot erase ownership of the originally acquired shadow');

  setup();phase='pixel-ratio';let nativeSettled=false,replaceObserver=false;
  releaseNative=()=>{nativeSettled=true;};
  const pendingNative=new Error('original unknown native constructor work');
  const originalObserver=function(){assert.equal(this,pendingNative);return nativeSettled;};
  Object.defineProperties(pendingNative,{cacheOwnershipPending:{value:true},cacheOwnershipReleased:{get(){return replaceObserver?()=>true:originalObserver;}}});
  Object.freeze(pendingNative);thrown=pendingNative;
  const pendingFailure=await rejected(initScene()),pendingRenderer=renderers.at(-1);
  assert.equal(pendingFailure.cause,pendingNative);assert.equal(pendingRenderer.calls,0);assert.equal(pendingRenderer.domElement.removed,0);
  replaceObserver=true;
  for(const owner of pendingFailure.sceneResourceOwners)assert.throws(()=>owner.release());
  assert.equal(pendingRenderer.calls,0,'unknown original native work gates construction resource retirement');
  nativeSettled=true;
  for(const owner of getPendingSceneResourceOwners())try{owner.release();}catch{}
  assert.equal(pendingRenderer.calls,1);assert.equal(pendingRenderer.domElement.removed,1);assert.equal(pendingFailure.sceneOwnershipReleased(),true);

  // Installed construction retains the original operation before any physical
  // shutdown. A direct disposer or a later initScene cannot bypass that gate.
  setup();phase='after-install';let installedSettled=false,replaceInstalledObserver=false;
  releaseNative=()=>{nativeSettled=true;installedSettled=true;};
  const installedNative=Object.freeze(Object.defineProperties(new Error('original installed constructor native work'),{
    cacheOwnershipPending:{value:true},cacheOwnershipReleased:{get(){return replaceInstalledObserver?()=>true:function(){
      assert.equal(this,installedNative);return installedSettled;
    };}}
  }));
  thrown=installedNative;
  const installedFailure=await rejected(initScene()),installedRenderer=renderers.at(-1),installedDispose=state.disposeScene;
  assert.equal(installedFailure.cause,installedNative);assert.equal(installedRenderer.calls,0);assert.equal(installedRenderer.domElement.removed,0);
  replaceInstalledObserver=true;
  assert.throws(()=>installedDispose(),error=>error===installedNative);
  const installedCount=renderers.length,blockedConstruction=await rejected(initScene());
  assert.equal(blockedConstruction,installedNative);assert.equal(renderers.length,installedCount);
  assert.equal(installedRenderer.calls,0,'original installed work gates direct and replacement construction shutdown');
  installedSettled=true;phase='';
  for(const owner of getPendingSceneResourceOwners())try{await owner.releaseAsync();}catch{}
  assert.equal(installedRenderer.calls,1);assert.equal(installedRenderer.domElement.removed,1);assert.equal(installedFailure.sceneOwnershipReleased(),true);

  // Actual enhancement initialization can fail after construction returned. Its
  // captured operation also gates the actual scene and every retry disposer.
  setup();phase='';let initializationSettled=false;
  releaseNative=()=>{nativeSettled=true;installedSettled=true;initializationSettled=true;};
  const initializationNative=Object.freeze(Object.defineProperty(new Error('original enhancement initialization work'),'cacheOwnershipReleased',{
    value(){assert.equal(this,initializationNative);return initializationSettled;}
  }));
  const pendingSummary={textContent:'',append(){}},pendingRetry={remove(){}};
  const pendingEnhancement=createRendererEnhancementOwner({state,summary:pendingSummary,retry:pendingRetry,
    loadModules:async()=>({THREE}),loadEnvironment:async()=>null,construct:initScene,
    initialize(){throw initializationNative;},renderSummary(){assert.fail('pending initialization cannot be accepted');}});
  const pendingResult=await pendingEnhancement.enhance(),initializationRenderer=renderers.at(-1),initializationDispose=state.disposeScene;
  assert.equal(pendingResult.reason,'failed');assert.equal(pendingResult.error.cause,initializationNative);
  assert.equal(state.rendererCapabilities.backend,'source-only');assert.equal(initializationRenderer.calls,0);
  assert.throws(()=>initializationDispose(),error=>error===initializationNative);
  const initializationCount=renderers.length,retriedResult=await pendingEnhancement.enhance();
  assert.equal(retriedResult.reason,'failed');assert.equal(renderers.length,initializationCount);assert.equal(initializationRenderer.calls,0);
  initializationSettled=true;
  for(const owner of getPendingSceneResourceOwners())try{await owner.releaseAsync();}catch{}
  assert.equal(initializationRenderer.calls,1);assert.equal(initializationRenderer.domElement.removed,1);
  assert.equal(pendingResult.error.sceneOwnershipReleased(),true);assert.equal(retriedResult.error.sceneOwnershipReleased(),true);
  pendingEnhancement.dispose();

  // Failure after shutdown installation still publishes source fallback for its
  // own closed scene, rather than misclassifying successful cleanup as takeover.
  setup();phase='after-install';thrown=primary;
  const summary={textContent:'',append(){}},retry={remove(){}};
  const enhancement=createRendererEnhancementOwner({state,summary,retry,loadModules:async()=>({THREE}),loadEnvironment:async()=>null,construct:initScene,
    initialize(){assert.fail('construction failed before initialization');},renderSummary(){assert.fail('failed construction cannot be accepted');}});
  const result=await enhancement.enhance(),closedRenderer=renderers.at(-1);
  assert.equal(result.reason,'failed');assert.equal(result.error.cause.cause,primary);
  assert.equal(state.rendererCapabilities.backend,'source-only');assert.match(summary.textContent,/3D unavailable/);
  assert.equal(closedRenderer.calls,1);assert.equal(closedRenderer.domElement.removed,1);enhancement.dispose();
}finally{
  refusing=false;phase='';releaseNative?.();for(const owner of getPendingSceneResourceOwners())try{owner.release();}catch{}
  for(const key of Object.keys(state))if(!Object.hasOwn(originalState,key))delete state[key];
  Object.assign(state,originalState);globalThis.window=originalWindow;globalThis.document=originalDocument;
}
console.log('Actual partial scene construction/original native observer controls authored; execution deferred.');
