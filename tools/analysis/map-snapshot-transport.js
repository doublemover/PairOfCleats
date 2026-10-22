import { MAP_DATA_PROTOCOL, SNAPSHOT_PAGE_LIMITS, snapshotRequest, sourceEntityKey } from '../../src/map/isometric/client/data/protocol.js';

const compactMember=(member,file,ordinal)=>({id:member.id??null,name:member.name??null,kind:member.kind??member.type??null,
  type:member.type??null,range:member.range??null,exported:member.exported??null,file,ordinal});
const compactFile=(file,row)=>({id:file.id??null,path:file.path||file.name,name:file.name||file.path,category:file.category??null,
  type:file.type??'file',ext:file.ext??null,row,memberCount:file.members?.length||0});

/** Pages an already admitted immutable map; never reads live artifacts or expands its query. */
export const createMapSnapshotTransport = ({model,snapshotId,identity,maxResponseBytes=SNAPSHOT_PAGE_LIMITS.responseBytes}) => {
  if(!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1024||maxResponseBytes>SNAPSHOT_PAGE_LIMITS.responseBytes)throw new Error('Snapshot responses require a finite budget up to 256 KiB.');
  let retired=false;
  let files=model.nodes||[],edges=model.edges||[];
  const fileByPath=new Map(),memberById=new Map(),adjacency=new Map();
  let members=0;
  const append=(key,row)=>{if(!adjacency.has(key))adjacency.set(key,[]);adjacency.get(key).push(row);};
  files.forEach((file,row)=>{
    const path=file.path||file.name;fileByPath.set(path,{file,row});
    (file.members||[]).forEach((member,ordinal)=>{members++;if(member.id!=null)memberById.set(sourceEntityKey('member',member.id),{file:path,member,ordinal});});
  });
  edges.forEach((edge,row)=>{
    const keys=new Set();
    for(const endpoint of [edge.from,edge.to]){
      const owner=endpoint?.member!=null?memberById.get(sourceEntityKey('member',endpoint.member))?.file:null;
      const file=endpoint?.file||owner;if(file)keys.add(sourceEntityKey('file',file));
      if(endpoint?.member!=null)keys.add(sourceEntityKey('member',endpoint.member));
    }
    for(const key of keys)append(key,row);
  });
  const manifest={protocol:MAP_DATA_PROTOCOL,snapshot:snapshotId,
    identity:{repo:model.root??null,selectedIndex:identity?.selectedIndex||model.provenance?.selectedIndex||null,
      producer:model.version??null,sourceRevision:model.provenance?.sourceRevision??null},
    counts:{files:files.length,members,edges:edges.length},
    coverage:{meaning:'available admitted export',sourceComplete:'unknown',upstreamDropped:model.summary?.dropped??null,
      truncated:model.summary?.truncated??null,scope:model.summary?.scope??model.options?.scope??null},
    limits:{...SNAPSHOT_PAGE_LIMITS,responseBytes:maxResponseBytes},
    capabilities:{files:true,members:true,directedAdjacency:true,lazyDetail:true,sourceQueryExpansion:false}};
  const wrap=(request,value)=>({protocol:MAP_DATA_PROTOCOL,snapshot:snapshotId,request:request.request,revision:request.revision,kind:request.kind,...value});
  const encode=value=>{const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>maxResponseBytes)throw new Error('A map record exceeds the snapshot response budget; use the admitted compatibility artifact for this detail.');return bytes;};
  const page=(request,rows,project=row=>row)=>{
    if(request.cursor>rows.length)throw new Error('Snapshot cursor exceeds the pinned page total.');
    const result=[],end=Math.min(rows.length,request.cursor+request.limit);let next=request.cursor;
    while(next<end){const candidate=project(rows[next],next),trial=wrap(request,{cursor:request.cursor,next:next+1<rows.length?next+1:null,total:rows.length,rows:[...result,candidate]});
      if(Buffer.byteLength(JSON.stringify(trial))>maxResponseBytes){if(!result.length)encode(trial);break;}
      result.push(candidate);next++;
    }
    return {cursor:request.cursor,next:next<rows.length?next:null,total:rows.length,rows:result};
  };
  return {manifest,
    respond(input){
      if(retired)throw new Error('Map snapshot transport has retired.');
      const request=snapshotRequest(input);
      if(input.protocol!==MAP_DATA_PROTOCOL||request.snapshot!==snapshotId)throw new Error('Requested map generation is unavailable in this pinned session.');
      if(request.kind==='manifest')return encode(wrap(request,{manifest}));
      if(request.kind==='files')return encode(wrap(request,page(request,files,compactFile)));
      if(request.kind==='members'){
        const file=fileByPath.get(request.file)?.file;if(!file)throw new Error('Source file unavailable in this snapshot.');
        return encode(wrap(request,page(request,file.members||[],(member,ordinal)=>compactMember(member,request.file,ordinal))));
      }
      if(request.kind==='edges')return encode(wrap(request,page(request,edges,(edge,row)=>({row,from:edge.from,to:edge.to,type:edge.type||'unknown'}))));
      if(request.kind==='adjacency'){
        const key=sourceEntityKey(request.entity?.type==='member'?'member':'file',request.entity?.type==='member'?request.entity.id:request.entity?.file);
        return encode(wrap(request,page(request,adjacency.get(key)||[],row=>({row,evidence:edges[row]}))));
      }
      if(request.kind==='detail'){
        const entity=request.entity,found=entity?.type==='member'?memberById.get(sourceEntityKey('member',entity.id)):fileByPath.get(entity?.file);
        if(!found||(entity?.type==='member'&&entity.file&&entity.file!==found.file))throw new Error('Source identity unavailable in this snapshot.');
        return encode(wrap(request,{detail:entity.type==='member'?found.member:{...found.file,members:undefined},file:entity.type==='member'?found.file:entity.file}));
      }
      throw new Error('Unsupported map snapshot operation.');
    },
    dispose(){retired=true;files=[];edges=[];fileByPath.clear();memberById.clear();adjacency.clear();}
  };
};
