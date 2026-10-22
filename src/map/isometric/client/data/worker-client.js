import { MAP_DATA_PROTOCOL, SNAPSHOT_PAGE_LIMITS } from './protocol.js';

/** One generation, bounded in-flight queries, one cancellable request per lane. */
export const createGraphWorkerClient = ({snapshot,endpoint,token,onProgress=()=>{},onFailure=()=>{},WorkerImpl=globalThis.Worker}) => {
  if(typeof WorkerImpl!=='function')throw new Error('Module workers are unavailable; using retained source navigation.');
  const worker=new WorkerImpl(new URL('./graph-worker.js',import.meta.url),{type:'module'}),pending=new Map(),lanes=new Map();
  let serial=0,retired=false,ready=false;
  const retireRequest=(request,error)=>{
    const entry=pending.get(request);if(!entry)return;pending.delete(request);if(lanes.get(entry.kind)===request)lanes.delete(entry.kind);entry.cleanup();entry.reject(error);
  };
  const failure=error=>{ready=false;if(!retired){retired=true;worker.terminate();}for(const request of [...pending.keys()])retireRequest(request,error);onFailure(error);};
  worker.onmessage=event=>{
    const message=event.data;if(retired||message.protocol!==MAP_DATA_PROTOCOL||message.snapshot!==snapshot)return;
    if(message.kind==='init'){if(message.event==='ready')ready=true;if(message.event==='error')failure(new Error(message.error));onProgress(message);return;}
    const entry=pending.get(message.request);if(!entry||entry.kind!==message.kind||entry.revision!==message.revision)return;
    pending.delete(message.request);if(lanes.get(entry.kind)===message.request)lanes.delete(entry.kind);entry.cleanup();
    if(message.event==='error')entry.reject(new Error(message.error));else entry.resolve(message.value);
  };
  worker.onerror=event=>{event.preventDefault?.();failure(new Error(event.message||'Snapshot worker failed; retained source navigation remains available.'));};
  worker.onmessageerror=()=>failure(new Error('Snapshot worker message could not be decoded.'));
  worker.postMessage({protocol:MAP_DATA_PROTOCOL,snapshot,request:++serial,revision:0,kind:'init',endpoint,token});
  const request=(kind,payload,{revision=0,signal}={})=>{
    if(retired||!ready)return Promise.reject(new Error('Snapshot query worker is not ready.'));
    const previous=lanes.get(kind);if(previous){worker.postMessage({protocol:MAP_DATA_PROTOCOL,kind:'cancel',lane:kind});retireRequest(previous,new DOMException('Superseded map query.','AbortError'));}
    if(pending.size>=SNAPSHOT_PAGE_LIMITS.inFlight)return Promise.reject(new Error('Snapshot worker is at its in-flight request budget. Retry after the pending operation.'));
    const id=++serial;
    return new Promise((resolve,reject)=>{
      const aborted=()=>{worker.postMessage({protocol:MAP_DATA_PROTOCOL,kind:'cancel',lane:kind});retireRequest(id,signal.reason||new DOMException('Cancelled map query.','AbortError'));};
      pending.set(id,{kind,revision,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',aborted)});lanes.set(kind,id);
      signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted){aborted();return;}
      worker.postMessage({protocol:MAP_DATA_PROTOCOL,snapshot,request:id,revision,kind,payload});
    });
  };
  return {request,get ready(){return ready;},dispose(){if(retired)return;retired=true;worker.postMessage({protocol:MAP_DATA_PROTOCOL,kind:'dispose'});worker.terminate();failure(new DOMException('Snapshot query owner retired.','AbortError'));}};
};
