import { snapshotRequest, acceptSnapshotResponse, SNAPSHOT_PAGE_LIMITS, MAP_DATA_PROTOCOL } from './protocol.js';
import { createSnapshotPageCache } from './page-cache.js';
import { buildStackModel } from '../stack-model.js';

const limit=(value,fallback,max)=>Math.min(max,Math.max(0,Number.isFinite(value)?Math.floor(value):fallback));
const address=entity=>entity.address?{type:entity.type,address:entity.address}:{type:entity.type,id:entity.id,file:entity.file};

/** Queries the pinned authoritative consumption view, retaining demand pages only. */
export const createDemandSnapshotSource = ({snapshot,fetchPage}) => {
  const cache=createSnapshotPageCache();let serial=0,manifest=null,retired=false;
  const get=async(kind,fields,signal,revision=0)=>{
    if(retired)throw new Error('Demand source owner has retired.');signal?.throwIfAborted();
    const key=JSON.stringify([kind,fields]),cached=cache.get(key);
    if(cached)return cached;
    const request=snapshotRequest({snapshot,request:++serial,revision,kind,...fields});
    const value=acceptSnapshotResponse(await fetchPage(request,signal),request);
    signal?.throwIfAborted();if(retired)throw new Error('Demand source retired during fetch.');cache.set(key,value);return value;
  };
  const resolve=(entity,signal,revision)=>get('resolve',{entity:address(entity)},signal,revision);
  return {
    snapshot,
    async init(signal,revision=0){
      const value=await get('manifest',{},signal,revision);manifest=value.manifest;
      if(manifest?.snapshot!==snapshot||manifest.protocol!==MAP_DATA_PROTOCOL||['files','members','edges'].some(key=>!Number.isSafeInteger(manifest.counts?.[key])||manifest.counts[key]<0))throw new Error('Demand manifest generation/counts mismatch.');return manifest;
    },
    async query(kind,payload={},signal,revision=0){
      if(!manifest)throw new Error('Demand source manifest is not ready.');
      if(kind==='resolve')return resolve(payload.entity,signal,revision);
      if(kind==='search'){
        const query=String(payload.query||'').trim();
        if(!query&&payload.entityType==='file'&&payload.directory==null){
          const page=await get('files',{cursor:payload.cursor||0,limit:payload.limit||80},signal,revision);
          return {...page,rows:page.rows.map(file=>({type:'file',file:file.path,name:file.name,memberCount:file.memberCount,address:{fileRow:file.row}})),complete:true};
        }
        return get('search',{query,entityType:payload.entityType||null,directory:payload.directory??null,cursor:payload.cursor||0,limit:payload.limit||80},signal,revision);
      }
      if(kind==='members')return get('members',{...(payload.fileRow!=null?{fileRow:payload.fileRow}:{file:payload.file}),cursor:payload.cursor||0,limit:payload.limit||40},signal,revision);
      if(kind==='detail'||kind==='adjacency-summary')return get(kind,{entity:address(payload.entity)},signal,revision);
      if(kind==='adjacency')return get('adjacency',{entity:address(payload.entity),cursor:payload.cursor||0,limit:payload.limit||40},signal,revision);
      if(kind!=='layout')throw new Error('Unsupported demand source operation.');
      const budgets=payload.budgets||{},limits={files:limit(budgets.files,60,500),members:limit(budgets.members,12000,12000),membersPerFile:limit(budgets.membersPerFile,20,12000),edges:limit(budgets.edges,16000,16000)};
      const selectedRecord=await resolve(payload.selection,signal,revision),selected=selectedRecord.entity;
      if(!limits.files||(selected.type==='member'&&(!limits.members||!limits.membersPerFile)))throw new Error('Render working-set budget cannot admit the selection. Increase its detail allowance.');
      const requested=new Map([[selectedRecord.file.path,selectedRecord.file]]),edgeRows=new Map(),owners=new Map();
      const discovery={observed:0,selectedAdjacencyTotal:null,evidenceBytes:0,complete:false,byteLimited:false},readLimit=Math.max(1,limits.edges),byteLimit=4*1024*1024;
      const ownerFor=endpoint=>endpoint?.member!=null?owners.get(String(endpoint.member)):endpoint?.file;
      const collect=async(entity,choosePeers)=>{
        let cursor=0;
        while(discovery.observed<readLimit&&discovery.evidenceBytes<byteLimit){
          const page=await get('adjacency',{entity:address(entity),cursor,limit:Math.min(SNAPSHOT_PAGE_LIMITS.rows,readLimit-discovery.observed)},signal,revision);
          if(choosePeers)discovery.selectedAdjacencyTotal=page.total;
          for(const row of page.rows){
            discovery.observed++;const evidence=row.evidence;
            if(evidence.from?.member!=null&&row.owners?.from)owners.set(String(evidence.from.member),row.owners.from);
            if(evidence.to?.member!=null&&row.owners?.to)owners.set(String(evidence.to.member),row.owners.to);
            if(choosePeers)for(const file of [row.owners?.from,row.owners?.to])if(file&&!requested.has(file)&&requested.size<limits.files)requested.set(file,null);
            if(!edgeRows.has(row.row)){const bytes=new TextEncoder().encode(JSON.stringify(evidence)).length;if(discovery.evidenceBytes+bytes>byteLimit){discovery.byteLimited=true;break;}edgeRows.set(row.row,evidence);discovery.evidenceBytes+=bytes;}
          }
          if(discovery.byteLimited)break;
          if(page.next===null){if(choosePeers)discovery.complete=true;break;}cursor=page.next;
        }
      };
      if(limits.edges)await collect(selected,true);
      for(const file of budgets.current||[])if(requested.size<limits.files&&!requested.has(file))requested.set(file,null);
      const nodes=[];let remaining=limits.members,layoutBytes=discovery.evidenceBytes;
      for(const [path,known]of requested){
        signal?.throwIfAborted();const file=known||(await resolve({type:'file',file:path},signal,revision)).file;
        const count=Math.min(limits.membersPerFile,remaining),start=path===selected.file&&selected.type==='member'&&count>0?Math.floor(selectedRecord.ordinal/count)*count:0;
        const members=[];let cursor=start;
        while(members.length<count&&cursor<file.memberCount){
          const page=await get('members',{fileRow:file.row,cursor,limit:Math.min(256,count-members.length)},signal,revision);
          if(!page.rows.length)throw new Error('Demand member continuation made no progress.');
          members.push(...page.rows);layoutBytes+=new TextEncoder().encode(JSON.stringify(page.rows)).length;
          if(layoutBytes>8*1024*1024)throw new Error('Resident detail exceeds its byte budget. Reduce the render working set; source evidence remains pageable.');
          if(page.next===null)break;cursor=page.next;
        }
        remaining-=members.length;nodes.push({...file,members,residency:{sourceMembers:file.memberCount,memberStart:start,memberEnd:start+members.length}});
      }
      for(const file of nodes)if(discovery.observed<readLimit&&limits.edges)await collect({type:'file',file:file.path,address:{fileRow:file.row}},false);
      const edges=[...edgeRows.values()].filter(edge=>requested.has(edge.from?.file||ownerFor(edge.from))&&requested.has(edge.to?.file||ownerFor(edge.to))).slice(0,limits.edges);
      const memberCount=nodes.reduce((sum,file)=>sum+file.members.length,0);
      const coverage={scope:'resident working set in pinned available snapshot',available:manifest.counts,resident:{files:nodes.length,members:memberCount,edges:edges.length},
        nonresident:{files:manifest.counts.files-nodes.length,members:manifest.counts.members-memberCount,edges:manifest.counts.edges-edges.length},sourceOmitted:manifest.coverage.upstreamDropped,queryExpanded:false,discovery};
      const model=buildStackModel(nodes,edges,{...payload.layout,maxFiles:limits.files,maxMembers:limits.members,maxEdges:limits.edges,fileByMember:owners});
      return {plan:{snapshot,selected,nodes,edges,limits,coverage},model,cache:cache.stats()};
    },
    stats(){return {mode:'demand',cache:cache.stats()};},
    releasePages(){cache.clear();},
    dispose(){retired=true;manifest=null;cache.dispose();}
  };
};
