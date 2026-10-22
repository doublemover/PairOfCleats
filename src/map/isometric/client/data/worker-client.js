import { MAP_DATA_PROTOCOL, SNAPSHOT_PAGE_LIMITS } from './protocol.js';
import { createSnapshotRequestQueue } from './request-queue.js';

/** One generation, bounded in-flight queries, one cancellable request per lane. */
export const createGraphWorkerClient = ({snapshot,endpoint,token,demand=false,onProgress=()=>{},onFailure=()=>{},WorkerImpl=globalThis.Worker}) => {
  if(typeof WorkerImpl!=='function')throw new Error('Module workers are unavailable; using retained source navigation.');
  const worker=new WorkerImpl(new URL('./graph-worker.js',import.meta.url),{type:'module'}),pending=new Map(),lanes=new Map();
  const queue=createSnapshotRequestQueue();
  let serial=0,retired=false,ready=false;
  const retireRequest=(request,error)=>{
    const entry=pending.get(request);if(!entry)return;pending.delete(request);if(lanes.get(entry.lane)===request)lanes.delete(entry.lane);entry.cleanup();entry.reject(error);
  };
  const failure=error=>{ready=false;queue.dispose(error);if(!retired){retired=true;worker.terminate();}for(const request of [...pending.keys()])retireRequest(request,error);onFailure(error);};
  worker.onmessage=event=>{
    const message=event.data;if(retired||message.protocol!==MAP_DATA_PROTOCOL||message.snapshot!==snapshot)return;
    if(message.kind==='init'){if(message.event==='ready')ready=true;if(message.event==='error')failure(new Error(message.error));onProgress(message);return;}
    const entry=pending.get(message.request);if(!entry||entry.kind!==message.kind||entry.revision!==message.revision)return;
    pending.delete(message.request);if(lanes.get(entry.lane)===message.request)lanes.delete(entry.lane);entry.cleanup();
    if(message.event==='error')entry.reject(new Error(message.error));else entry.resolve(message.value);
  };
  worker.onerror=event=>{event.preventDefault?.();failure(new Error(event.message||'Snapshot worker failed; retained source navigation remains available.'));};
  worker.onmessageerror=()=>failure(new Error('Snapshot worker message could not be decoded.'));
  try{worker.postMessage({protocol:MAP_DATA_PROTOCOL,snapshot,request:++serial,revision:0,kind:'init',endpoint,token,demand});}
  catch(error){queue.dispose(error);retired=true;worker.terminate();throw error;}
  const dispatch=(kind,payload,{revision=0,signal,lane=kind}={})=>{
    if(retired||!ready)return Promise.reject(new Error('Snapshot query worker is not ready.'));
    const previous=lanes.get(lane);if(previous){worker.postMessage({protocol:MAP_DATA_PROTOCOL,kind:'cancel',lane});retireRequest(previous,new DOMException('Superseded map query.','AbortError'));}
    if(pending.size>=SNAPSHOT_PAGE_LIMITS.inFlight)return Promise.reject(new Error('Snapshot worker is at its in-flight request budget. Retry after the pending operation.'));
    const id=++serial;
    return new Promise((resolve,reject)=>{
      const aborted=()=>{worker.postMessage({protocol:MAP_DATA_PROTOCOL,kind:'cancel',lane});retireRequest(id,signal.reason||new DOMException('Cancelled map query.','AbortError'));};
      pending.set(id,{kind,lane,revision,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',aborted)});lanes.set(lane,id);
      signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted){aborted();return;}
      try{worker.postMessage({protocol:MAP_DATA_PROTOCOL,snapshot,request:id,revision,kind,lane,payload});}
      catch(error){retireRequest(id,error);}
    });
  };
  const request=(kind,payload,options={})=>queue.request({lane:options.lane||kind,signal:options.signal,
    run:signal=>dispatch(kind,payload,{...options,signal})});
  return {request,stats:()=>queue.stats(),get ready(){return ready;},dispose(){if(retired)return;retired=true;queue.dispose();worker.postMessage({protocol:MAP_DATA_PROTOCOL,kind:'dispose'});worker.terminate();failure(new DOMException('Snapshot query owner retired.','AbortError'));}};
};
