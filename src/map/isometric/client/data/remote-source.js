import { state } from '../state.js';
import { createDemandSnapshotSource } from './demand-source.js';
import { readBoundedJsonResponse, sourceEntityKey } from './protocol.js';
import { createSnapshotRequestQueue } from './request-queue.js';
import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';
import { captureSceneFailure } from '../scene-failure-inspection.js';
import { createSceneWorkPrerequisites } from '../scene-work-prerequisites.js';

/** Main thread retains the selected record and current resident compact model only. */
export const createRemoteSource = config => {
  const {manifest,snapshot:snapshotId,endpoint,token}=config;
  const snapshot=Object.freeze({id:snapshotId,summary:{dropped:manifest.coverage.upstreamDropped}});
  const files=new Map(),members=new Map(),typedMembers=new Map(),fileByMember=new Map(),residentPaths=new Set();let selection=null,disposed=false,navigationEpoch=0,navigationAbortOwner=null,active=0,cleaning=false;
  const lifetime=new AbortController(),directQueue=createSnapshotRequestQueue();
  const originalFetch=globalThis.fetch;
  const direct=createDemandSnapshotSource({snapshot:snapshotId,fetchPage:async(request,signal)=>{
    const response=await Reflect.apply(originalFetch,globalThis,[endpoint,{method:'POST',signal,headers:{'Content-Type':'application/json','X-Map-Session':token},body:JSON.stringify(request)}]);
    return readBoundedJsonResponse(response,{signal});
  }});
  const originalInit=direct.init,originalQuery=direct.query,originalReleasePages=direct.releasePages;
  const originalQueueRequest=directQueue.request,originalQueueStats=directQueue.stats;
  const originalWork=callback=>{active++;try{return callback();}finally{active--;}};
  const work=Object.freeze(Object.defineProperty(new Error('Original remote source callback has not returned.'),'sceneOwnershipReleased',{value:()=>active===0}));
  const cleanupWork=Object.freeze(Object.defineProperty(new Error('Original remote source cleanup has not returned.'),'sceneOwnershipReleased',{value:()=>!cleaning}));
  const prerequisites=createSceneWorkPrerequisites('Original remote source operation remains pending.');
  prerequisites.retain(work);
  let directReady=null;
  const request=async(kind,payload,options={})=>{
    if(!published())throw new DOMException('Remote source publication has retired.','AbortError');
    return originalWork(()=>{
      const workerReady=state.graphWorkerReady;
      if(!published())throw new DOMException('Remote source publication changed.','AbortError');
      if(workerReady===true){
        const client=state.graphWorkerClient;
        if(!published())throw new DOMException('Remote source publication changed.','AbortError');
        const originalRequest=client.request;
        if(!published()||state.graphWorkerClient!==client)throw new DOMException('Remote source requester changed.','AbortError');
        return Reflect.apply(originalRequest,client,[kind,payload,options]);
      }
      return Reflect.apply(originalQueueRequest,directQueue,[{lane:options.lane||kind,signal:options.signal,run:async signal=>{
        directReady ||= Reflect.apply(originalInit,direct,[lifetime.signal]).catch(error=>{directReady=null;throw error;});
        await directReady;signal.throwIfAborted();return Reflect.apply(originalQuery,direct,[kind,payload,signal,options.revision||0]);
      }}]);
    });
  };
  const registerMember=(file,member)=>{if(member.id!=null){const value={file,member};typedMembers.set(sourceEntityKey('member',member.id),value);members.set(String(member.id),value);fileByMember.set(String(member.id),file);}};
  const registerSelection=record=>{
    if(selection&&!residentPaths.has(selection.file.path)){
      const path=selection.file.path;files.delete(path);
      if(selection.entity.type==='member'){
        const id=selection.entity.id;members.delete(String(id));fileByMember.delete(String(id));typedMembers.delete(sourceEntityKey('member',id));
      }
    }
    selection=record;const file={...record.file,members:files.get(record.file.path)?.members||[]};files.set(file.path,file);
    if(record.entity.type==='member')registerMember(file.path,record.entity);
  };
  const index={snapshot,counts:manifest.counts,files,members,fileByMember,remote:true,
    member:id=>typedMembers.get(sourceEntityKey('member',id))||members.get(String(id)),
    resolve(info){
      if(disposed)return null;
      if(!info)return null;
      if(info.type==='member'){const found=typedMembers.get(sourceEntityKey('member',info.id))||members.get(String(info.id));return found&&(!info.file||info.file===found.file)?{...info,...found.member,type:'member',file:found.file}:null;}
      const file=files.get(info.file||info.name);return file?{...info,type:'file',file:file.path,name:file.name}:null;
    },
    relationships(){return [];}
  };
  const published=()=>!disposed&&state.remoteSource===remote&&state.sourceIndex===index;
  const lifetimeOwner=prerequisites.attach(captureSceneResource(lifetime,'original remote source lifetime abort','abort',[],{required:true}));
  const queueOwner=prerequisites.attach(captureSceneResource(directQueue,'original remote source direct queue'));
  const directOwner=prerequisites.attach(captureSceneResource(direct,'original remote source demand pages'));
  const metadataOwner=prerequisites.attach(captureSceneResource({dispose(){files.clear();members.clear();typedMembers.clear();fileByMember.clear();residentPaths.clear();selection=null;}},'original remote source metadata'));
  const resourceOwner=prerequisites.attach(captureSceneResource({dispose(){
    cleaning=true;
    try{
      const errors=[];
      for(const owner of [navigationAbortOwner,lifetimeOwner,queueOwner,directOwner,metadataOwner])if(owner)try{owner.retire();}catch(error){errors.push(error);}
      const failure=preserveSceneCleanupFailures(null,errors);if(failure)throw failure;
    }finally{cleaning=false;}
  }},'original remote source retirement'));
  resourceOwner.retainFailure(cleanupWork);
  const remote={manifest,index,request,
    async navigate(info,accept){
      if(!published())return {ok:false,reason:'superseded'};
      const epoch=++navigationEpoch;
      let dom,summary,revisions,summaryCaptured=false,currentFailed=false,currentFailure;
      const current=()=>{
        if(currentFailed)throw currentFailure;
        try{return epoch===navigationEpoch&&published()&&state.dom===dom&&state.viewRevisions===revisions&&(!summaryCaptured||dom.summary===summary);}
        catch(error){currentFailed=true;currentFailure=error;prerequisites.retain(error);throw error;}
      };
      try{
        dom=state.dom;
        if(epoch!==navigationEpoch||!published())return {ok:false,reason:'superseded'};
        revisions=state.viewRevisions;
        if(!current())return {ok:false,reason:'superseded'};
        summary=dom.summary;summaryCaptured=true;
        if(!current())return {ok:false,reason:'superseded'};
        const bump=revisions?.bump;
        if(!current())return {ok:false,reason:'superseded'};
        if(typeof bump==='function')originalWork(()=>Reflect.apply(bump,revisions,['selection']));
        if(!current())return {ok:false,reason:'superseded'};
        const cancel=state.cancelCameraMotion;
        if(!current())return {ok:false,reason:'superseded'};
        if(typeof cancel==='function')originalWork(()=>Reflect.apply(cancel,state,[]));
        if(!current())return {ok:false,reason:'superseded'};
        navigationAbortOwner?.retire();
        if(!current())return {ok:false,reason:'superseded'};
        const navigationController=new AbortController();
        navigationAbortOwner=prerequisites.attach(captureSceneResource(navigationController,'original remote navigation abort','abort',[],{required:true}));
        navigationAbortOwner.assertCaptured();
        const record=await request('resolve',{entity:info},{signal:navigationController.signal});
        if(!current())return {ok:false,reason:'superseded'};
        registerSelection(record);
        if(!current())return {ok:false,reason:'superseded'};
        originalWork(()=>accept(record.entity));return current()?{ok:true}:{ok:false,reason:'superseded'};
      }catch(primary){
        let admitted=false;const authorityErrors=[];
        try{admitted=current();}catch(error){if(!Object.is(error,primary))authorityErrors.push(error);}
        if(!admitted){
          prerequisites.retain(primary,{diagnostics:false});
          return {ok:false,reason:currentFailed?'authority-unavailable':'superseded',primaryError:primary,
            error:preserveSceneCleanupFailures(primary,authorityErrors,{hasPrimary:true,diagnostics:false})};
        }
        prerequisites.retain(primary);
        const captured=captureSceneFailure(primary),errors=[];
        try{if(current()&&captured.name!=='AbortError')summary.textContent=`Source selection unavailable: ${captured.message}`;}
        catch(error){errors.push(error);prerequisites.retain(error);}
        return {ok:false,primaryError:primary,error:preserveSceneCleanupFailures(primary,errors,{hasPrimary:true}),inspectionErrors:captured.inspectionErrors};
      }
    },
    registerPlan(plan){
      if(disposed)throw new DOMException('Remote source has retired.','AbortError');
      files.clear();members.clear();typedMembers.clear();fileByMember.clear();residentPaths.clear();
      for(const file of plan.nodes){residentPaths.add(file.path||file.name);files.set(file.path||file.name,file);for(const member of file.members||[])registerMember(file.path||file.name,member);}
      if(selection)registerSelection(selection);
    },
    async detail(info,signal){return (await request('detail',{entity:info},{signal})).detail;},
    releaseFallbackPages(){if(!disposed)Reflect.apply(originalReleasePages,direct,[]);},
    stats(){return {directRequests:Reflect.apply(originalQueueStats,directQueue,[]),workerRequests:published()?state.graphWorkerClient?.stats?.()||null:null};},
    get retired(){return disposed;},get resourceOwner(){return resourceOwner;},
    get pendingOwners(){return Object.freeze([resourceOwner,navigationAbortOwner,lifetimeOwner,queueOwner,directOwner,metadataOwner].filter(owner=>owner?.pending));},
    dispose(){disposed=true;navigationEpoch++;if(cleaning)throw cleanupWork;if(active){resourceOwner.retainFailure(work);throw work;}return resourceOwner.retire();}
  };
  return remote;
};
