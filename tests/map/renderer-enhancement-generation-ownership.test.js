import assert from 'node:assert/strict';
import { createRendererEnhancementOwner } from '../../src/map/isometric/client/rendering/enhancement-owner.js';
import { getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';

// Actual enhancement orchestrator with inert asynchronous module/scene seams.
const gates=[],deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});
  const gate={promise,resolve,reject};gates.push(gate);return gate;};
const primary=Object.freeze(new AggregateError([new Error('original load leaf')],'original enhancement failure'));
const createFixture=overrides=>{
  const state={sourceIndex:{},remoteSource:null,dom:{}},summary={textContent:'',append(){}},retry={remove(){}};
  const scenes=[];let initialized=0,summaries=0;
  const owner=createRendererEnhancementOwner({state,summary,retry,
    loadModules:async()=>({THREE:{revision:'current'}}),loadEnvironment:async()=>null,
    construct:async({isCurrent,onSceneOwner})=>{
      if(!isCurrent())return;
      const previous=state.disposeScene;if(previous)previous.call(state);
      const scene={},renderer={calls:0};let closed=false;
      const disposeScene=()=>{if(closed)return;closed=true;renderer.calls++;if(state.disposeScene===disposeScene)state.disposeScene=null;};
      Object.assign(state,{scene,renderer,disposeScene});scenes.push({scene,renderer,disposeScene});onSceneOwner({scene,renderer,disposeScene});
    },initialize:()=>{initialized++;},renderSummary:()=>{summaries++;summary.textContent='current renderer ready';},...overrides});
  return {state,summary,scenes,owner,get initialized(){return initialized;},get summaries(){return summaries;}};
};
try{
  const oldImport=deferred(),oldImportEntered=deferred();let imports=0;
  const fixture=createFixture({loadModules:()=>{if(imports++===0){oldImportEntered.resolve();return oldImport.promise;}return {THREE:{revision:'newer'}};}});
  const first=fixture.owner.enhance();await oldImportEntered.promise;
  assert.equal((await fixture.owner.enhance()).ok,true);const accepted=fixture.state.renderer;
  oldImport.reject(primary);const older=await first;
  assert.equal(older.reason,'superseded');assert.equal(older.error.cause,primary);
  assert.equal(fixture.state.THREE.revision,'newer');assert.equal(fixture.state.renderer,accepted);assert.equal(accepted.calls,0);
  assert.equal(fixture.initialized,1);assert.equal(fixture.summaries,1);assert.equal(fixture.state.rendererFailure,null);
  assert.equal(fixture.summary.textContent,'current renderer ready');

  const oldEnvironment=deferred(),environmentEntered=deferred();let environments=0;
  const environmentFixture=createFixture({loadEnvironment:()=>{if(environments++===0){environmentEntered.resolve();return oldEnvironment.promise;}return 'new-environment';}});
  const oldEnvironmentWork=environmentFixture.owner.enhance();await environmentEntered.promise;
  assert.equal((await environmentFixture.owner.enhance()).ok,true);oldEnvironment.resolve('old-environment');
  assert.equal((await oldEnvironmentWork).reason,'superseded');assert.equal(environmentFixture.state.RGBELoader,'new-environment');
  assert.equal(environmentFixture.scenes.length,1);

  const construction=deferred(),constructed=deferred();let attempts=0,capturedOldDisposer;
  const constructionFixture=createFixture({construct:async({onSceneOwner})=>{
    const index=attempts++,scene={},renderer={calls:0};let closed=false;
    const previous=constructionFixture.state.disposeScene;if(previous)previous();
    const disposeScene=()=>{if(closed)return;closed=true;renderer.calls++;if(constructionFixture.state.disposeScene===disposeScene)constructionFixture.state.disposeScene=null;};
    Object.assign(constructionFixture.state,{scene,renderer,disposeScene});onSceneOwner({scene,renderer,disposeScene});
    if(index===0){capturedOldDisposer=disposeScene;constructed.resolve();await construction.promise;}
  }});
  const oldConstruction=constructionFixture.owner.enhance();await constructed.promise;
  const oldRenderer=constructionFixture.state.renderer;
  assert.equal((await constructionFixture.owner.enhance()).ok,true);const newRenderer=constructionFixture.state.renderer;
  constructionFixture.state.disposeScene=()=>assert.fail('old cleanup cannot look up sibling disposer');
  construction.reject(primary);const oldConstructionResult=await oldConstruction;
  assert.equal(oldConstructionResult.reason,'superseded');assert.equal(oldConstructionResult.error.cause,primary);
  assert.equal(oldRenderer.calls,1);assert.equal(newRenderer.calls,0);assert.equal(constructionFixture.state.rendererFailure,null);
  capturedOldDisposer();assert.equal(oldRenderer.calls,1,'successful original close is remembered');

  const retiredImport=deferred(),retiredEntered=deferred();
  const retired=createFixture({loadModules:()=>{retiredEntered.resolve();return retiredImport.promise;}});
  const retiredWork=retired.owner.enhance();await retiredEntered.promise;retired.owner.dispose();retiredImport.resolve({THREE:{}});
  assert.equal((await retiredWork).reason,'superseded');assert.equal(retired.initialized,0);assert.equal(retired.scenes.length,0);
  assert.equal((await retired.owner.enhance()).reason,'retired');

  const sourceImport=deferred(),sourceEntered=deferred(),source=createFixture({loadModules:()=>{sourceEntered.resolve();return sourceImport.promise;}});
  const sourceWork=source.owner.enhance();await sourceEntered.promise;source.state.sourceIndex={};source.summary.textContent='new source';
  sourceImport.reject(undefined);const oldSourceResult=await sourceWork;
  assert.equal(oldSourceResult.reason,'superseded');assert.equal(oldSourceResult.error.cause,undefined);assert.equal(source.summary.textContent,'new source');
}finally{
  for(const gate of gates)gate.resolve(null);
  for(const owner of getPendingSceneResourceOwners())try{owner.release();}catch{}
}
console.log('Enhancement generation/original scene retirement controls authored; execution deferred.');
