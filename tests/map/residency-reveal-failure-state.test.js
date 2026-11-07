import assert from 'node:assert/strict';
import { initResidencyOwner } from '../../src/map/isometric/client/data/residency-owner.js';
import { state } from '../../src/map/isometric/client/state.js';
import { createRendererBoundary } from '../../src/map/isometric/client/rendering/boundary.js';

// Actual reveal/disposal consumer with an inert source and boundary dispatch.
const originalState={...state},leaf=Object.freeze(new Error('post-publication callback failed'));
const rejected=work=>work.then(()=>assert.fail('expected boundary failure'),error=>error);
try{
  const published={published:false},controller=new AbortController();
  const producer=createRendererBoundary({capabilities:{},prepare:async()=>published,
    commit:()=>{published.published=true;throw leaf;},retire:()=>assert.fail('accepted scene cannot retire')});
  const publishedFailure=await rejected(producer.transact({stamp:{request:1},signal:controller.signal,current:()=>true,finish(){},cancel(){}},{}));
  const sourceIndex={snapshot:{},counts:{files:1,members:1}},summary={textContent:'source ready'};
  const selected={type:'file',file:'known.ts'},plan={selected,coverage:{resident:{files:1,members:1}},limits:{},nodes:[],edges:[]};
  Object.assign(state,{disposeResidency:null,sourceIndex,layoutStyle:'stacks',renderer:null,selectedInfo:null,dom:{summary},
    performance:{drawCaps:{files:1,members:1,edges:1}},displayLimits:{maxFiles:1,maxMembersPerFile:1},layout:{groupDepth:1},
    remoteSource:{request:async()=>({plan,model:{}})},stackModel:null});
  const owner=initResidencyOwner();
  owner.boundary.transact=async operation=>{operation.finish();throw publishedFailure;};
  const result=await owner.reveal(selected);
  assert.equal(result.committed,true);assert.equal(result.reason,'renderer-follow-up');assert.equal(result.error,publishedFailure);
  assert.equal(state.rendererFailure,publishedFailure);assert.match(summary.textContent,/Resident evidence committed/);
  assert.doesNotMatch(summary.textContent,/did not replace/);

  for(const failure of [leaf,undefined,null,false,0,'']){
    owner.boundary.transact=async operation=>{operation.finish();throw failure;};
    const failed=await owner.reveal(selected);
    assert.equal(failed.committed,false);assert.equal(failed.error,failure);assert.ok(Object.hasOwn(failed,'error'));
    assert.match(summary.textContent,/Reveal did not replace the prior scene/);
  }
  owner.boundary.dispose=()=>{throw undefined;};
  assert.throws(()=>owner.dispose(),failure=>{assert.equal(failure.cause,undefined);assert.deepEqual(failure.errors,[undefined]);return true;});
  assert.equal(state.viewRevisions,null);assert.equal(state.revealSourceSelection,null);assert.equal(state.cancelResidentPreparation,null);
  assert.equal(state.rendererBoundary,null);assert.equal(state.disposeResidency,null);
  assert.throws(()=>owner.revisions.begin('late',['source']),/retired/,'revision retirement still runs after boundary cancellation failure');

  let rejectOld;const oldRequest=new Promise((resolve,reject)=>{rejectOld=reject;});
  Object.assign(state,{sourceIndex,remoteSource:{request:()=>oldRequest},selectedInfo:null});
  const oldOwner=initResidencyOwner(),lateReveal=oldOwner.reveal(selected),siblingFailure=Object.freeze(new Error('current source failure'));
  const siblingRevisions={},siblingSource={},siblingBoundary={},siblingReveal=()=>{},siblingDispose=()=>{};
  Object.assign(state,{viewRevisions:siblingRevisions,sourceIndex:siblingSource,rendererBoundary:siblingBoundary,disposeResidency:siblingDispose,
    rendererFailure:siblingFailure,revealSourceSelection:siblingReveal});
  summary.textContent='current source status';rejectOld(leaf);
  const lateResult=await lateReveal;assert.equal(lateResult.error,leaf);assert.equal(lateResult.committed,false);
  assert.equal(state.rendererFailure,siblingFailure);assert.equal(summary.textContent,'current source status','late prior-source failure cannot replace current status');
  assert.equal((await oldOwner.reveal(selected)).reason,'superseded');assert.equal(summary.textContent,'current source status');
  oldOwner.dispose();assert.equal(state.viewRevisions,siblingRevisions);assert.equal(state.revealSourceSelection,siblingReveal);
  assert.equal(state.rendererBoundary,siblingBoundary);assert.equal(state.disposeResidency,siblingDispose);
}finally{
  for(const key of Object.keys(state))if(!Object.hasOwn(originalState,key))delete state[key];
  Object.assign(state,originalState);
}
console.log('Actual residency reveal publication/failure/disposal controls authored; execution deferred.');
