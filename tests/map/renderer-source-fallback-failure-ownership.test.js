import assert from 'node:assert/strict';
import { enterSourceRendererFallback, invalidateRendererFallback } from '../../src/map/isometric/client/rendering/failure-state.js';
import { captureSceneResource, getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual fallback consumer with inert source/status and scoped cleanup objects.
const leaf=Object.freeze(new Error('original renderer construction leaf'));
const primary=Object.freeze(new AggregateError([leaf],'original renderer construction failure',{cause:leaf}));
const cleanup=Object.freeze(new Error('original captured scene cleanup failure'));
let refusing=true,releaseAsyncCleanup=null;
const releases=[];
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});releases.push(resolve);return {promise,resolve};};
try{
  const resource={calls:0,dispose(){this.calls++;if(refusing)throw cleanup;}};
  const owner=captureSceneResource(resource,'fallback original renderer'),sourceIndex={},remoteSource={},appended=[];
  const summary={textContent:'',append(value){appended.push(value);}},retry={type:'button'};
  const state={sourceIndex,remoteSource,disposeScene(){assert.equal(this,state);owner.retire();}};
  const failure=await enterSourceRendererFallback({state,summary,retry,error:primary});
  assert.equal(failure.cause,primary);assert.equal(failure.errors[0],primary);assert.equal(failure.errors[1].cause,cleanup);
  assert.equal(failure.sceneOwnershipPending,true);assert.equal(state.rendererFailure,failure);assert.equal(state.sceneRetirementFailure,failure);
  assert.equal(state.rendererCapabilities.backend,'source-only');assert.equal(state.rendererCapabilities.sourceNavigation,true);
  assert.equal(state.rendererCapabilities.worldGeometry,false);assert.equal(state.rendererCapabilities.measuredAcceptance,'not-qualified');
  assert.equal(state.sourceIndex,sourceIndex);assert.equal(state.remoteSource,remoteSource);assert.deepEqual(appended,[retry]);
  assert.match(summary.textContent,/original renderer construction failure/);assert.match(summary.textContent,/Source hierarchy and inspection remain usable/);
  assert.ok(state.sceneRetirementOwners.includes(owner));assert.equal(resource.calls,1);
  await enterSourceRendererFallback({state,summary,retry,error:primary});assert.equal(resource.calls,1,'display fallback does not retry a failed native close');
  resource.dispose=()=>assert.fail('reconciliation preserves captured original renderer method');
  refusing=false;owner.release();assert.equal(resource.calls,2);assert.equal(failure.sceneOwnershipReleased(),true);

  let enteredCleanup;const entered=new Promise(resolve=>{enteredCleanup=resolve;});
  const cleanupGate=new Promise(resolve=>{releaseAsyncCleanup=resolve;});
  const asyncState={disposeScene:async()=>{enteredCleanup();await cleanupGate;throw cleanup;}};
  const asyncFailure=enterSourceRendererFallback({state:asyncState,summary,retry,error:primary});
  await entered;assert.equal(asyncState.rendererCapabilities.backend,'source-only');
  assert.equal(asyncState.rendererFailure.cause,primary);assert.match(summary.textContent,/Source hierarchy and inspection remain usable/);
  releaseAsyncCleanup();assert.deepEqual((await asyncFailure).errors,[primary,cleanup]);

  const staleEntered=deferred(),staleCleanup=deferred(),siblingFailure=Object.freeze(new Error('current renderer failure'));
  const staleResource={calls:0,dispose(){this.calls++;if(refusing)throw cleanup;}},staleOwner=captureSceneResource(staleResource,'original fallback sibling blocker');
  refusing=true;
  const staleState={sourceIndex:{},remoteSource:{},scene:{},renderer:{},
    disposeScene:async()=>{staleEntered.resolve();await staleCleanup.promise;staleOwner.retire();}};
  const oldFallback=enterSourceRendererFallback({state:staleState,summary,retry,error:primary});await staleEntered.promise;
  invalidateRendererFallback(staleState);
  const siblingSource={},siblingScene={},siblingRenderer={},siblingOwners=[],siblingCapabilities={backend:'current-renderer'};
  Object.assign(staleState,{sourceIndex:siblingSource,remoteSource:{},scene:siblingScene,renderer:siblingRenderer,disposeScene:()=>{},
    rendererFailure:siblingFailure,sceneRetirementFailure:siblingFailure,sceneRetirementError:'current retirement',
    sceneRetirementOwners:siblingOwners,rendererCapabilities:siblingCapabilities});
  summary.textContent='current renderer status';staleCleanup.resolve();const oldFailure=await oldFallback;
  assert.equal(oldFailure.cause,primary);assert.equal(oldFailure.sceneOwnershipPending,true);assert.ok(oldFailure.sceneResourceOwners.includes(staleOwner));
  assert.equal(staleState.rendererFailure,siblingFailure);assert.equal(staleState.sceneRetirementFailure,siblingFailure);
  assert.equal(staleState.sceneRetirementOwners,siblingOwners);assert.equal(staleState.sceneRetirementError,'current retirement');
  assert.equal(staleState.rendererCapabilities,siblingCapabilities);assert.equal(summary.textContent,'current renderer status');
  assert.equal(staleResource.calls,1);assert.ok(getPendingSceneResourceOwners().includes(staleOwner));
  refusing=false;staleOwner.release();assert.equal(oldFailure.sceneOwnershipReleased(),true);

  // Overlapping fallbacks can share the source/disposer yet still have distinct
  // publication owners. The older completion cannot replace the newer failure.
  const overlapGates=[deferred(),deferred()],overlapEntered=[deferred(),deferred()];let overlapCalls=0;
  const overlapState={disposeScene:async()=>{const index=overlapCalls++;overlapEntered[index].resolve();await overlapGates[index].promise;throw cleanup;}};
  const older=enterSourceRendererFallback({state:overlapState,summary,retry,error:primary});await overlapEntered[0].promise;
  const newer=enterSourceRendererFallback({state:overlapState,summary,retry,error:siblingFailure});await overlapEntered[1].promise;
  const initialNewerFailure=overlapState.rendererFailure;overlapGates[0].resolve();
  assert.equal((await older).cause,primary);assert.equal(overlapState.rendererFailure,initialNewerFailure);
  assert.match(summary.textContent,/current renderer failure/);
  overlapGates[1].resolve();const newerFailure=await newer;
  assert.equal(overlapState.rendererFailure,newerFailure);assert.equal(newerFailure.cause,siblingFailure);

  const retryEntered=deferred(),retryGate=deferred(),sameState={disposeScene:async()=>{retryEntered.resolve();await retryGate.promise;throw cleanup;}};
  const superseded=enterSourceRendererFallback({state:sameState,summary,retry,error:primary});await retryEntered.promise;
  invalidateRendererFallback(sameState);sameState.rendererFailure=siblingFailure;
  retryGate.resolve();await superseded;assert.equal(sameState.rendererFailure,siblingFailure,'a new enhancement invalidates fallback before acquiring a different scene');

  for(const value of [undefined,null,false,0,'']){
    const captureState={};Object.defineProperty(captureState,'disposeScene',{get(){throw value;}});
    const captured=await enterSourceRendererFallback({state:captureState,summary,retry,error:value});
    assert.equal(captured.cause,value);assert.deepEqual(captured.errors,[value,value]);
    assert.equal(captureState.rendererCapabilities.backend,'source-only');assert.equal(captureState.rendererFailure,captured);
    assert.match(summary.textContent,/Renderer operation failed/);
  }
}finally{
  refusing=false;releaseAsyncCleanup?.();for(const release of releases)release();for(const owner of getPendingSceneResourceOwners())try{owner.release();}catch{}
}
console.log('Source fallback keeps exact primary/cleanup owners and source capability; authored and unrun.');
