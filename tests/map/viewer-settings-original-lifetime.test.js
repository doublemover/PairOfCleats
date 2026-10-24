import assert from 'node:assert/strict';
import { createViewerSettingsSession, emptyViewerPreferences, validateViewerPreferences } from '../../src/map/isometric/client/effective-settings.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const outcome=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
const contains=(root,wanted,seen=new Set())=>{
  if(Object.is(root,wanted))return true;if(!root||typeof root!=='object'||seen.has(root))return false;seen.add(root);
  return contains(root.cause,wanted,seen)||(root.errors||[]).some(value=>contains(value,wanted,seen));
};
{
  const entered=gate(),work=gate(),writes=[],statuses=[];
  const session=createViewerSettingsSession({repoId:'original-repo',onStatus:status=>statuses.push(status),persist:async value=>{
    writes.push(value);entered.resolve();await work.promise;return{...value,revision:value.revision+1};
  }});
  session.update({appearance:{palette:'crisp'}});const saving=session.save();await entered.promise;
  session.reset();const queued=outcome(session.save());
  const retirement=session.dispose();assert.equal(session.dispose(),retirement);const count=statuses.length;
  let settled=false;retirement.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false,'retirement waits for the actual accepted write');
  assert.equal(session.retired,true);assert.equal(session.resourceOwner.pending,true);
  assert.throws(()=>session.update({}),{name:'AbortError'});assert.throws(()=>session.reset(),{name:'AbortError'});
  assert.throws(()=>session.scheduleSave(),{name:'AbortError'});await assert.rejects(session.save(),{name:'AbortError'});
  work.resolve();assert.equal((await saving).revision,1);assert.equal((await queued).error.name,'AbortError');await retirement;
  assert.equal(writes.length,1,'retirement does not start a queued stale write');assert.equal(statuses.length,count,'late accepted write does not publish into a retired UI');
  assert.equal(session.document.revision,0,'late confirmation remains in the returned original operation rather than mutating retired state');
  assert.equal(session.resourceOwner.pending,false);assert.equal(session.status,'retired');
}
{
  const entered=gate(),work=gate();let calls=0;
  const session=createViewerSettingsSession({repoId:'direct-owner-repo',persist:async value=>{calls++;entered.resolve();await work.promise;return{...value,revision:value.revision+1};}});
  const saving=session.save();await entered.promise;const direct=session.resourceOwner.retireAsync();
  assert.equal(session.retired,true,'the actual original owner retires admission even when invoked directly');
  await assert.rejects(session.save(),{name:'AbortError'});work.resolve();await saving;await direct;assert.equal(calls,1);
}
{
  let originalReleased=false,calls=0;const entered=gate(),work=gate();
  const original=Object.freeze(Object.defineProperty(new Error('accepted native preference write remains pending'),'cacheOwnershipReleased',{value:()=>originalReleased}));
  const session=createViewerSettingsSession({repoId:'pending-repo',persist:async()=>{calls++;entered.resolve();await work.promise;throw original;}});
  const saving=outcome(session.save());await entered.promise;const retirement=outcome(session.dispose());work.resolve();
  assert(contains((await saving).error,original));assert(contains((await retirement).error,original));
  await assert.rejects(session.resourceOwner.releaseAsync());assert.equal(calls,1,'disposal never retries a durable write');
  originalReleased=true;await session.resourceOwner.releaseAsync();assert.equal(session.resourceOwner.pending,false);assert.equal(calls,1);
}
for(const change of [value=>({...value,revision:value.revision}),value=>({...value,revision:value.revision+2}),
  value=>({...value,revision:value.revision+1,preferences:{base:{},layouts:{}}})]){
  let calls=0;const session=createViewerSettingsSession({repoId:'receipt-repo',persist:async value=>{calls++;return change(value);}});
  session.update({appearance:{palette:'crisp'}});await assert.rejects(session.save(),/original requested update/);
  assert.equal(session.document.revision,0);assert.match(session.status,/save-failed/);await session.dispose();assert.equal(calls,1);
}
{
  const notification=Object.freeze(new Error('original failure-status callback failed'));
  const session=createViewerSettingsSession({repoId:'committed-repo',persist:async value=>({...value,revision:value.revision+1}),onStatus(status){
    if(status==='saved')throw undefined;if(status.startsWith('save-failed:'))throw notification;
  }});
  const result=await outcome(session.save());assert.equal(result.ok,false);assert.equal(result.error.cause,undefined);
  assert(contains(result.error,notification));assert.equal(result.error.viewerPreferencesCommitted,true);assert.equal(result.error.viewerPreferencesRevision,1);
  assert.equal(session.document.revision,1,'status failure cannot erase an actual confirmed write');await session.dispose();
}
{
  let reads=0;const original=Object.freeze(Object.defineProperty({},'message',{get(){reads++;throw false;}}));
  const session=createViewerSettingsSession({repoId:'diagnostic-repo',persist:async()=>{throw original;}});
  const result=await outcome(session.save());assert.equal(result.ok,false);assert.equal(result.error.cause,original);assert(contains(result.error,false));
  assert.equal(reads,1,'original diagnostic getters are not reread while reporting');await session.dispose();
}
{
  const session=createViewerSettingsSession({repoId:'layout-repo'});
  for(const layout of ['__proto__','constructor','prototype','',12]){
    assert.throws(()=>session.update({appearance:{palette:'crisp'}},{layout}),/layout/);assert.throws(()=>session.reset({layout}),/layout/);
  }
  const document=emptyViewerPreferences('layout-repo');document.preferences.layouts=JSON.parse('{"constructor":{}}');
  assert.throws(()=>validateViewerPreferences(document,'layout-repo'),/layout/);assert.deepEqual(session.document.preferences,{base:{},layouts:{}});await session.dispose();
}
console.log('Viewer preference writes retain original queue, retirement, receipt and notification outcomes.');
