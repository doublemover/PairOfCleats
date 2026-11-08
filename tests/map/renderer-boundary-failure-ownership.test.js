import assert from 'node:assert/strict';
import { createRendererBoundary } from '../../src/map/isometric/client/rendering/boundary.js';
import { commitResidentScene } from '../../src/map/isometric/client/rendering/resident-scene.js';
import { captureSceneResource, getPendingSceneResourceOwners } from '../../src/map/isometric/client/scene-retirement.js';
import { state } from '../../src/map/isometric/client/state.js';

// Actual boundary/commit owners with inert resources; no renderer or DOM host.
const originalState={...state},gates=[];
const rejected=work=>work.then(()=>assert.fail('expected original transaction failure'),error=>error);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});const value={promise,resolve};gates.push(value);return value;};
const operation=()=>{
  const controller=new AbortController(),counts={finish:0,cancel:0};
  return {stamp:{request:1},signal:controller.signal,current:()=>!controller.signal.aborted,counts,
    finish(){counts.finish++;},cancel(){counts.cancel++;controller.abort();}};
};
const primary=Object.freeze(new AggregateError([new Error('nested original')],'original commit failure'));
const cleanup=Object.freeze(new Error('candidate cleanup failure')),finishFailure=Object.freeze(new Error('original operation completion failure'));
let refusing=true;
try{
  for(const original of [primary,undefined,null,false,0,'']){
    const resource={calls:0,dispose(){this.calls++;if(refusing)throw cleanup;}};
    const owner=captureSceneResource(resource,'detached candidate');let capturedCleanup;
    const candidate={},op=operation();op.finish=()=>{op.counts.finish++;throw finishFailure;};
    const boundary=createRendererBoundary({capabilities:{},prepare:async()=>candidate,commit:()=>{throw original;},
      retire:()=>{try{owner.retire();}catch(error){capturedCleanup=error;throw error;}}});
    const failure=await rejected(boundary.transact(op,{}));
    assert.equal(failure.cause,original);assert.deepEqual(failure.errors,[original,capturedCleanup,finishFailure]);
    assert.equal(failure.rendererTransactionCommitted,false);assert.equal(failure.rendererTransactionCleanupFailed,true);
    assert.equal(failure.rendererTransactionPhase,'commit');assert.equal(failure.rendererTransactionStamp,op.stamp);
    assert.equal(op.counts.finish,1);assert.equal(boundary.lastFailure,failure);assert.equal(resource.calls,1);
    resource.dispose=()=>assert.fail('keep originally captured candidate disposer');
    boundary.dispose();assert.equal(resource.calls,1,'boundary shutdown does not retry failed resource closure');
    refusing=false;owner.release();assert.equal(resource.calls,2);assert.equal(failure.sceneOwnershipReleased(),true);refusing=true;
  }

  const retirement=deferred(),retired=deferred(),asyncOperation=operation();
  const asyncBoundary=createRendererBoundary({capabilities:{},prepare:async()=>({}),commit:()=>{throw primary;},
    retire:async()=>{retired.resolve();await retirement.promise;throw cleanup;}});
  const asyncFailure=rejected(asyncBoundary.transact(asyncOperation,{}));await retired.promise;
  assert.equal(asyncOperation.counts.finish,0,'accepted retirement settles before operation completion');
  retirement.resolve();assert.deepEqual((await asyncFailure).errors,[primary,cleanup]);assert.equal(asyncOperation.counts.finish,1);

  const published={published:false},publishedOperation=operation();let retiredPublished=0;
  const publishedBoundary=createRendererBoundary({capabilities:{},prepare:async()=>published,
    commit:()=>{published.published=true;throw primary;},retire:()=>{retiredPublished++;}});
  const publishedFailure=await rejected(publishedBoundary.transact(publishedOperation,{}));
  assert.equal(publishedFailure.rendererTransactionCommitted,true);assert.equal(retiredPublished,0);assert.equal(publishedOperation.counts.finish,1);
  Object.freeze(publishedFailure);
  const nestedOperation=operation(),nestedBoundary=createRendererBoundary({capabilities:{},prepare:async()=>({}),
    commit:()=>{throw publishedFailure;},retire:()=>{}});
  const nestedFailure=await rejected(nestedBoundary.transact(nestedOperation,{}));
  assert.equal(nestedFailure.cause,publishedFailure);assert.equal(nestedFailure.rendererTransactionCommitted,false);
  assert.equal(nestedFailure.rendererTransactionStamp,nestedOperation.stamp,'new transaction owns its metadata rather than copying frozen stale publication');

  const firstGate=deferred(),secondGate=deferred(),first=operation(),second=operation();let cancelledCandidates=0;
  first.cancel=()=>{first.counts.cancel++;throw undefined;};
  const cancelling=createRendererBoundary({capabilities:{},prepare:request=>request.promise,commit:()=>assert.fail('retired boundary cannot commit'),retire:()=>{cancelledCandidates++;}});
  const firstWork=cancelling.transact(first,firstGate),secondWork=cancelling.transact(second,secondGate);
  assert.throws(()=>cancelling.dispose(),error=>{assert.deepEqual(error.errors,[undefined]);return true;});
  assert.equal(first.counts.cancel,1);assert.equal(second.counts.cancel,1,'one cancel failure cannot skip an independent pending operation');
  firstGate.resolve({});secondGate.resolve({});
  assert.equal((await firstWork).committed,false);assert.equal((await secondWork).committed,false);
  assert.equal(cancelledCandidates,2);assert.equal(first.counts.finish,1);assert.equal(second.counts.finish,1);

  // The actual commit publishes before remote/presentation callbacks. Failure
  // there still attempts every previous group and preserves the accepted scene.
  const keys=['fileGroup','memberGroup','labelGroup','edgeGroup','wireGroup'],oldGeometries=[];
  class Group{
    constructor(child=null){this.children=child?[child]:[];this.userData={};}
    add(child){this.children.push(child);}
    remove(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);}
    traverse(visit){visit(this);for(const child of [...this.children])visit(child);}
  }
  const oldGroups=Object.fromEntries(keys.map((key,index)=>{
    const geometry={calls:0,dispose(){this.calls++;if(index===0&&refusing)throw cleanup;}};oldGeometries.push(geometry);
    return [key,new Group({geometry,userData:{}})];
  }));
  const nextGroups=Object.fromEntries(keys.map(key=>[key,new Group()])),scene=new Group();
  for(const group of Object.values(oldGroups))scene.add(group);
  let pickCloses=0,fenceCloses=0;
  Object.assign(state,oldGroups,{scene,stackPipeOwners:[],stackPacketOwner:null,appearance:null,viewRevisions:null,
    remoteSource:{registerPlan(){throw primary;}},pickIndex:{dispose(){pickCloses++;}},pickFence:{dispose(){fenceCloses++;}},
    sourceIndex:{resolve(){throw finishFailure;}}});
  const accepted={published:false,values:{...nextGroups,stackPipeOwners:[],stackPacketOwner:null,memberInstanceById:new Map(),fileInstanceByKey:new Map()}};
  const actual=createRendererBoundary({capabilities:{},prepare:async()=>accepted,commit:commitResidentScene,retire:()=>assert.fail('published actual candidate is retained')});
  const actualFailure=await rejected(actual.transact(operation(),{selected:{type:'file',file:'known.ts'}}));
  assert.equal(actualFailure.rendererTransactionCommitted,true);assert.equal(accepted.published,true);
  assert.equal(actualFailure.cause.cause,primary);assert.equal(pickCloses,1);assert.equal(fenceCloses,1);
  assert.deepEqual(oldGeometries.map(geometry=>geometry.calls),[1,1,1,1,1]);
  assert.deepEqual(scene.children,Object.values(nextGroups));assert.equal(state.fileGroup,nextGroups.fileGroup);
  assert.equal(actualFailure.sceneOwnershipPending,true);refusing=false;
  for(const owner of actualFailure.sceneResourceOwners)owner.release();
  assert.equal(actualFailure.sceneOwnershipReleased(),true);assert.deepEqual(oldGeometries.map(geometry=>geometry.calls),[2,1,1,1,1]);
}finally{
  refusing=false;for(const gate of gates)gate.resolve({});
  for(const owner of getPendingSceneResourceOwners())try{owner.release();}catch{}
  for(const key of Object.keys(state))if(!Object.hasOwn(originalState,key))delete state[key];
  Object.assign(state,originalState);
}
console.log('Renderer transaction failure/commit/independent cleanup controls authored; execution deferred.');
