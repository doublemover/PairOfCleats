import { MAP_DATA_PROTOCOL, SNAPSHOT_PAGE_LIMITS, snapshotRequest, acceptSnapshotResponse } from './protocol.js';
import { createGraphStore } from './graph-store.js';
import { planSourceResidency } from './residency.js';
import { buildStackModel } from '../stack-model.js';
import { createDemandSnapshotSource } from './demand-source.js';

/** The owner is testable without a worker host. Only bounded envelopes cross it. */
export const createSnapshotWorkerOwner = ({fetchPage,post}) => {
  let epoch=0,serial=0,accepted=null,acceptedDemand=null,loading=null,retired=false;
  const lanes=new Map();
  const reply=(request,value)=>post({protocol:MAP_DATA_PROTOCOL,snapshot:request.snapshot,request:request.request,revision:request.revision,kind:request.kind,...value});
  const stopLane=lane=>{lanes.get(lane)?.abort();lanes.delete(lane);};
  const load=async request=>{
    loading?.abort();const controller=new AbortController();loading=controller;const ownEpoch=++epoch,reportedPhases=new Set();let candidate=null;
    const fetch=async(kind,fields={})=>{
      controller.signal.throwIfAborted();
      const query=snapshotRequest({snapshot:request.snapshot,request:++serial,revision:request.revision,kind,...fields});
      const result=await fetchPage(query,controller.signal);return acceptSnapshotResponse(result,query);
    };
    const pages=async(kind,fields={})=>{
      let cursor=0,total=null;
      for(;;){const result=await fetch(kind,{...fields,cursor,limit:SNAPSHOT_PAGE_LIMITS.rows});
        if(total===null)total=result.total;
        if(result.total!==total||!Number.isSafeInteger(total)||total<0||result.cursor!==cursor||!Array.isArray(result.rows)
          ||cursor+result.rows.length>total||(result.next===null?cursor+result.rows.length!==total:result.next!==cursor+result.rows.length||result.next<=cursor))throw new Error('Invalid map page continuation.');
        candidate.admit(kind,result.rows,new TextEncoder().encode(JSON.stringify(result.rows)).length);
        // At most one queued phase message per row family. Full progress is in
        // the final accepted-store receipt; page count cannot flood a hidden UI.
        if(!reportedPhases.has(kind)){reportedPhases.add(kind);reply(request,{phase:kind,progress:candidate.stats(),event:'progress'});}
        if(result.next===null)break;cursor=result.next;
      }
    };
    try{
      if(request.demand){
        const demand=createDemandSnapshotSource({snapshot:request.snapshot,fetchPage});candidate=demand;
        const manifest=await demand.init(controller.signal,request.revision);controller.signal.throwIfAborted();
        if(retired||ownEpoch!==epoch)return;
        reply(request,{event:'overview',manifest});accepted?.dispose();accepted=null;acceptedDemand?.dispose();acceptedDemand=demand;candidate=null;
        reply(request,{event:'ready',manifest,stats:demand.stats()});return;
      }
      const result=await fetch('manifest'),manifest=result.manifest;
      if(manifest?.protocol!==MAP_DATA_PROTOCOL||manifest.snapshot!==request.snapshot||['files','members','edges'].some(key=>!Number.isSafeInteger(manifest.counts?.[key])||manifest.counts[key]<0))throw new Error('Pinned map manifest identity/counts are invalid.');
      candidate=createGraphStore(manifest);
      reply(request,{event:'overview',manifest:result.manifest});
      await pages('files');
      for(const file of candidate.files.values())if(file.memberCount)await pages('members',{file:file.path});
      await pages('edges');controller.signal.throwIfAborted();
      if(retired||ownEpoch!==epoch)return;
      candidate.finish();const previous=accepted;accepted=candidate;candidate=null;previous?.dispose();acceptedDemand?.dispose();acceptedDemand=null;
      reply(request,{event:'ready',stats:accepted.stats(),manifest:result.manifest});
    }catch(error){if(!controller.signal.aborted&&!retired)reply(request,{event:'error',error:error.message,retainedSnapshot:accepted?.snapshot||acceptedDemand?.snapshot||null});}
    finally{candidate?.dispose();if(loading===controller)loading=null;}
  };
  return {
    async handle(request){
      if(retired)return;
      if(request.protocol!==MAP_DATA_PROTOCOL)return;
      if(request.kind==='init'){await load(request);return;}
      if(request.kind==='cancel'){stopLane(request.lane);return;}
      if(request.kind==='dispose'){this.dispose();return;}
      const lane=request.lane||request.kind,kind=request.kind;stopLane(lane);const controller=new AbortController();lanes.set(lane,controller);
      try{
        if(acceptedDemand?.snapshot===request.snapshot){
          const own=acceptedDemand,value=await own.query(kind,request.payload,controller.signal,request.revision);
          controller.signal.throwIfAborted();if(own===acceptedDemand&&lanes.get(lane)===controller)reply(request,{event:'result',value});return;
        }
        if(!accepted||accepted.snapshot!==request.snapshot)throw new Error('Requested graph generation is not ready; retained source navigation remains available.');
        const store=accepted;let value;
        if(kind==='search')value=await store.search({...request.payload,signal:controller.signal});
        else if(kind==='adjacency')value=store.adjacency(request.payload.entity,request.payload);
        else if(kind==='detail'){
          const query=snapshotRequest({snapshot:request.snapshot,request:++serial,revision:request.revision,kind:'detail',entity:request.payload.entity});
          value=acceptSnapshotResponse(await fetchPage(query,controller.signal),query);
        }else if(kind==='layout'){
          await new Promise(resolve=>setTimeout(resolve,0));controller.signal.throwIfAborted();
          const index=store.sourceIndex(),plan=planSourceResidency(index,request.payload.selection,request.payload.budgets);
          const model=buildStackModel(plan.nodes,plan.edges,{...request.payload.layout,maxFiles:plan.limits.files,maxMembers:plan.limits.members,maxEdges:plan.limits.edges,fileByMember:index.fileByMember});
          value={plan,model};
        }else throw new Error('Unsupported graph worker operation.');
        controller.signal.throwIfAborted();if(accepted!==store)throw new Error('Graph generation changed during query.');
        if(lanes.get(lane)===controller)reply(request,{event:'result',value});
      }catch(error){if(!controller.signal.aborted&&!retired)reply(request,{event:'error',error:error.message});}
      finally{if(lanes.get(lane)===controller)lanes.delete(lane);}
    },
    dispose(){if(retired)return;retired=true;epoch++;loading?.abort();for(const controller of lanes.values())controller.abort();lanes.clear();accepted?.dispose();accepted=null;acceptedDemand?.dispose();acceptedDemand=null;}
  };
};
