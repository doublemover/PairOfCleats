import assert from 'node:assert/strict';
import { captureCrossEncoderResource, createCrossEncoderSessionOwner } from '../../../src/retrieval/rerankers/local-resource-owner.js';

// Original scoped owners only; no native runtime, session, model or storage IO.
let closeConfirmed=false,calls=0;
const resource={dispose(){calls++;return closeConfirmed;}},captured=captureCrossEncoderResource(resource,'dispose');
await assert.rejects(captured.close(),{code:'ERR_LOCAL_RERANKER_RESOURCE_UNCONFIRMED'});
assert.equal(captured.pending,true);closeConfirmed=true;await captured.close();await captured.close();assert.equal(calls,2);

let finishClose,enteredClose;
const closeGate=new Promise(resolve=>{finishClose=resolve;}),entered=new Promise(resolve=>{enteredClose=resolve;});
let nativeSettled=false,replaceObserver=false,asyncCloses=0;
const child=new Error('independent original child still pending');
const original=function(){assert.equal(this,child);return nativeSettled;};
Object.defineProperty(child,'cacheOwnershipReleased',{get(){return replaceObserver?()=>true:original;}});Object.freeze(child);
const asyncResource={async dispose(){asyncCloses++;enteredClose();await closeGate;}},asyncCaptured=captureCrossEncoderResource(asyncResource,'dispose');
try{
  const closing=asyncCaptured.close();await entered;asyncCaptured.retainFailure(child);finishClose();
  await assert.rejects(closing,error=>error===child);assert.equal(asyncCloses,1);assert.equal(asyncCaptured.pending,true);
  replaceObserver=true;await assert.rejects(asyncCaptured.close(),error=>error===child);assert.equal(asyncCloses,1);
  nativeSettled=true;await asyncCaptured.close();assert.equal(asyncCloses,1,'fulfilled original native close is remembered through pending child reconciliation');
}finally{nativeSettled=true;finishClose();await asyncCaptured.close().catch(()=>{});}

let queueCloses=0,storageCloses=0,sessionCloses=0,tokenizerCloses=0,artifactCloses=0,foreignSettled=false,owner;
const lease={resourceId:'inert-original-cross-encoder',releaseAfterSettlement(receipt){
  assert.deepEqual(receipt,{resourceId:this.resourceId,settled:true,pending:false});storageCloses++;return true;
}};
const copied=new Error('copied owner fields are not producer proof');
const queue={async close(){if(queueCloses++===0)throw copied;}};
owner=createCrossEncoderSessionOwner({queue,sessionLease:lease});
Object.defineProperties(copied,{rerankerOwner:{value:owner},storageSession:{value:lease},cacheOwnershipPending:{value:true},
  cacheOwnershipReleased:{value(){assert.equal(this,copied);return foreignSettled;}}});Object.freeze(copied);
owner.adoptSession({release(){sessionCloses++;}});owner.adoptTokenizer({dispose(){tokenizerCloses++;}});owner.adoptArtifact({release(){artifactCloses++;}});
try{
  const failure=await owner.close().then(()=>assert.fail('expected copied foreign owner failure'),error=>error);
  assert.equal(failure.cleanupErrors[0],copied);assert.notEqual(failure,copied);assert.equal(failure.rerankerOwner,owner);
  await assert.rejects(owner.close(),error=>error.cacheOwnershipPending===true);
  assert.equal(sessionCloses,0);assert.equal(tokenizerCloses,0);assert.equal(artifactCloses,0);assert.equal(storageCloses,0);
  foreignSettled=true;await owner.close();assert.equal(failure.cacheOwnershipReleased(),true);
  assert.equal(sessionCloses,1);assert.equal(tokenizerCloses,1);assert.equal(artifactCloses,1);assert.equal(storageCloses,1);
}finally{foreignSettled=true;await owner.close().catch(()=>{});}
console.log('Cross-encoder exact resource confirmation/original observer/copy negative controls authored; execution deferred.');
