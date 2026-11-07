import { createSnapshotWorkerOwner } from './worker-owner.js';
import { readBoundedJsonResponse } from './protocol.js';

let endpoint=null,token=null;
const owner=createSnapshotWorkerOwner({post:value=>self.postMessage(value),fetchPage:async(request,signal)=>{
  const response=await fetch(endpoint,{method:'POST',signal,headers:{'Content-Type':'application/json','X-Map-Session':token},body:JSON.stringify(request)});
  return readBoundedJsonResponse(response,{signal});
}});
self.onmessage=event=>{
  if(event.data.kind==='init'){
    const target=new URL(event.data.endpoint,self.location.href);
    if(target.origin!==self.location.origin){self.postMessage({...event.data,event:'error',error:'Snapshot worker requires a same-origin session endpoint.'});return;}
    endpoint=target.href;token=event.data.token;
  }
  owner.handle(event.data).catch(error=>self.postMessage({...event.data,event:'error',error:error.message}));
};
