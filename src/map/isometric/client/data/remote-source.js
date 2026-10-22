import { state } from '../state.js';
import { createDemandSnapshotSource } from './demand-source.js';
import { readBoundedJsonResponse, sourceEntityKey } from './protocol.js';

/** Main thread retains the selected record and current resident compact model only. */
export const createRemoteSource = config => {
  const manifest=config.manifest,snapshot=Object.freeze({id:config.snapshot,summary:{dropped:manifest.coverage.upstreamDropped}});
  const files=new Map(),members=new Map(),typedMembers=new Map(),fileByMember=new Map(),residentPaths=new Set();let selection=null,disposed=false,navigationEpoch=0,navigationController=null;
  const lifetime=new AbortController();
  const direct=createDemandSnapshotSource({snapshot:config.snapshot,fetchPage:async(request,signal)=>{
    const response=await fetch(config.endpoint,{method:'POST',signal,headers:{'Content-Type':'application/json','X-Map-Session':config.token},body:JSON.stringify(request)});
    return readBoundedJsonResponse(response,{signal});
  }});
  let directReady=null;
  const request=async(kind,payload,options={})=>{
    if(disposed)throw new Error('Remote source has retired.');
    if(state.graphWorkerReady)return state.graphWorkerClient.request(kind,payload,options);
    directReady ||= direct.init(lifetime.signal);
    await directReady;return direct.query(kind,payload,options.signal,options.revision||0);
  };
  const registerMember=(file,member)=>{if(member.id!=null){const value={file,member};typedMembers.set(sourceEntityKey('member',member.id),value);members.set(String(member.id),value);fileByMember.set(String(member.id),file);}};
  const registerSelection=record=>{
    if(selection&&!residentPaths.has(selection.file.path)){
      const path=selection.file.path;files.delete(path);
      for(const [key,value]of members)if(value.file===path){members.delete(key);fileByMember.delete(key);typedMembers.delete(sourceEntityKey('member',value.member.id));}
    }
    selection=record;const file={...record.file,members:files.get(record.file.path)?.members||[]};files.set(file.path,file);
    if(record.entity.type==='member')registerMember(file.path,record.entity);
  };
  const index={snapshot,counts:manifest.counts,files,members,fileByMember,remote:true,
    resolve(info){
      if(!info)return null;
      if(info.type==='member'){const found=typedMembers.get(sourceEntityKey('member',info.id))||members.get(String(info.id));return found&&(!info.file||info.file===found.file)?{...info,...found.member,type:'member',file:found.file}:null;}
      const file=files.get(info.file||info.name);return file?{...info,type:'file',file:file.path,name:file.name}:null;
    },
    relationships(){return [];}
  };
  return {manifest,index,request,
    async navigate(info,accept){
      const epoch=++navigationEpoch;
      state.viewRevisions?.bump('selection');state.cancelCameraMotion?.();
      navigationController?.abort();navigationController=new AbortController();
      try{const record=await request('resolve',{entity:info},{signal:navigationController.signal});if(disposed||epoch!==navigationEpoch)return;
        registerSelection(record);accept(record.entity);
      }catch(error){if(epoch===navigationEpoch&&!disposed)state.dom.summary.textContent=`Source selection unavailable: ${error.message}`;}
    },
    registerPlan(plan){
      files.clear();members.clear();typedMembers.clear();fileByMember.clear();residentPaths.clear();
      for(const file of plan.nodes){residentPaths.add(file.path||file.name);files.set(file.path||file.name,file);for(const member of file.members||[])registerMember(file.path||file.name,member);}
      if(selection)registerSelection(selection);
    },
    async detail(info,signal){return (await request('detail',{entity:info},{signal})).detail;},
    releaseFallbackPages(){direct.releasePages();},
    dispose(){disposed=true;navigationEpoch++;navigationController?.abort();lifetime.abort();direct.dispose();files.clear();members.clear();typedMembers.clear();fileByMember.clear();selection=null;}
  };
};
