import { sourceEntityKey, SNAPSHOT_PAGE_LIMITS } from './protocol.js';
import { createSnapshotSearchIndex } from './search-index.js';

/** Compact canonical rows only. Rich inspection stays in generation-bound detail pages. */
export const createGraphStore = manifest => {
  const files=new Map(),members=new Map(),edges=[],incoming=new Map(),outgoing=new Map(),fileAdjacency=new Map(),fileByMember=new Map();
  const searchIndex=createSnapshotSearchIndex();
  let retired=false,complete=false,retainedBytes=0,revision=0;
  const assertLive=()=>{if(retired)throw new Error('Graph store has retired.');};
  const index=(map,key,row)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(row);};
  const keys=endpoint=>{
    const memberKey=endpoint?.member!=null?sourceEntityKey('member',endpoint.member):null;
    const file=endpoint?.file||(memberKey?members.get(memberKey)?.file:null);
    return {memberKey,fileKey:file?sourceEntityKey('file',file):null};
  };
  return {snapshot:manifest.snapshot,manifest,files,members,
    admit(kind,rows,byteLength=0){
      assertLive();
      if(!Number.isSafeInteger(byteLength)||byteLength<0)throw new Error('Invalid graph byte accounting.');
      if(retainedBytes+byteLength>32*1024*1024)throw new Error('Compact graph exceeds its worker retention budget; prior accepted source remains usable.');
      for(const row of rows){
        if(kind==='files'){
          const value={...row,members:[],search:`${row.path} ${row.name||''}`.toLowerCase()};
          files.set(row.path,value);searchIndex.admit('file',value);
        }
        else if(kind==='members'){
          const file=files.get(row.file);if(!file||row.ordinal!==file.members.length)throw new Error('Graph member continuation is not exact.');
          const value={...row,search:`${row.file} ${row.name||''} ${row.kind||''} ${row.id??''}`.toLowerCase()};file.members.push(value);
          if(row.id!=null){members.set(sourceEntityKey('member',row.id),value);fileByMember.set(String(row.id),row.file);searchIndex.admit('member',value);}
        }else if(kind==='edges'){
          if(row.row!==edges.length)throw new Error('Graph edge continuation is not exact.');edges.push(row);
          const from=keys(row.from),to=keys(row.to);
          for(const key of [from.memberKey,from.fileKey].filter(Boolean))index(outgoing,key,row.row);
          for(const key of [to.memberKey,to.fileKey].filter(Boolean))index(incoming,key,row.row);
          for(const key of new Set([from.fileKey,to.fileKey].filter(Boolean)))index(fileAdjacency,key,row.row);
        }else throw new Error('Unsupported compact graph row family.');
      }
      retainedBytes+=byteLength;revision++;
    },
    finish(){
      assertLive();
      const memberRows=[...files.values()].reduce((sum,file)=>sum+file.members.length,0);
      if(files.size!==manifest.counts.files||memberRows!==manifest.counts.members||edges.length!==manifest.counts.edges
        ||[...files.values()].some(file=>file.members.length!==file.memberCount))throw new Error('Compact graph pages do not reconcile with the pinned manifest.');
      searchIndex.seal();complete=true;revision++;
    },
    sourceIndex(){
      assertLive();return {snapshot:{summary:{dropped:manifest.coverage.upstreamDropped}},counts:manifest.counts,files,fileByMember,
        resolve(entity){if(entity?.type==='member'){const value=members.get(sourceEntityKey('member',entity.id));return value&&(!entity.file||value.file===entity.file)?{...value,type:'member'}:null;}
          const value=files.get(entity?.file||entity?.name);return value?{type:'file',file:value.path,name:value.name}:null;},
        relationships(entity){const key=sourceEntityKey(entity.type==='member'?'member':'file',entity.type==='member'?entity.id:entity.file);
          const rows=entity.type==='file'?fileAdjacency.get(key)||[]:[...new Set([...(incoming.get(key)||[]),...(outgoing.get(key)||[])])];return rows.map(row=>edges[row]);}};
    },
    async search({query='',cursor=0,limit=80,entityType=null,signal,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
      assertLive();if(!Number.isInteger(limit)||limit<1||limit>256||!Number.isSafeInteger(cursor)||cursor<0)throw new Error('Invalid search page.');
      if(typeof query!=='string'||query.length>4096)throw new Error('Snapshot search query exceeds its bounded text contract.');
      const sourceRevision=revision,text=query.trim().toLowerCase(),rows=[];let matched=0,visited=0,pageBytes=0,pageClosed=false;
      for(const ordinal of searchIndex.candidates(text)){
        const {type:kind,value}=searchIndex.row(ordinal);
        if(entityType&&kind!==entityType)continue;
        if(++visited%512===0){await yieldTask();signal?.throwIfAborted();assertLive();if(revision!==sourceRevision)throw new Error('Graph query superseded by newly admitted pages.');}
        if(text&&!value.search.includes(text))continue;
        if(matched>=cursor&&rows.length<limit&&!pageClosed){
          const row=kind==='file'?{type:'file',file:value.path,name:value.name,memberCount:value.memberCount}:{type:'member',file:value.file,id:value.id,name:value.name,range:value.range};
          const bytes=new TextEncoder().encode(JSON.stringify(row)).length;
          if(pageBytes+bytes+4096>SNAPSHOT_PAGE_LIMITS.responseBytes){if(!rows.length)throw new Error('Search result exceeds the worker page budget; inspect it through the retained compatibility source.');pageClosed=true;}
          else{rows.push(row);pageBytes+=bytes;}
        }
        matched++;
      }
      signal?.throwIfAborted();return {snapshot:manifest.snapshot,rows,cursor,next:cursor+rows.length<matched?cursor+rows.length:null,total:complete?matched:null,observedMatches:matched,complete,visited};
    },
    adjacency(entity,{cursor=0,limit=80,direction='both'}={}){
      assertLive();const key=sourceEntityKey(entity.type==='member'?'member':'file',entity.type==='member'?entity.id:entity.file);
      const rows=direction==='incoming'?incoming.get(key)||[]:direction==='outgoing'?outgoing.get(key)||[]
        :entity.type==='file'?fileAdjacency.get(key)||[]:[...new Set([...(incoming.get(key)||[]),...(outgoing.get(key)||[])])].sort((a,b)=>a-b);
      return {snapshot:manifest.snapshot,rows:rows.slice(cursor,cursor+limit).map(row=>edges[row]),cursor,next:cursor+limit<rows.length?cursor+limit:null,total:complete?rows.length:null,complete};
    },
    stats(){return {files:files.size,members:members.size,edges:edges.length,retainedWireBytes:retainedBytes,heapBytes:'unmeasured',complete,revision,searchIndex:searchIndex.stats()};},
    dispose(){retired=true;files.clear();members.clear();edges.length=0;incoming.clear();outgoing.clear();fileAdjacency.clear();fileByMember.clear();searchIndex.dispose();}
  };
};
