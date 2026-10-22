import { MAP_DATA_PROTOCOL, SNAPSHOT_PAGE_LIMITS, snapshotRequest, sourceEntityKey } from '../../src/map/isometric/client/data/protocol.js';
import { createSnapshotSearchIndex } from '../../src/map/isometric/client/data/search-index.js';

const compactMember=(member,file,ordinal)=>({id:member.id??null,name:member.name??null,kind:member.kind??member.type??null,
  type:member.type??null,range:member.range??null,exported:member.exported??null,file,ordinal});
const compactFile=(file,row)=>({id:file.id??null,path:file.path||file.name,name:file.name||file.path,category:file.category??null,
  type:file.type??'file',ext:file.ext??null,row,memberCount:file.members?.length||0});

/** Pages an already admitted immutable map; never reads live artifacts or expands its query. */
export const createMapSnapshotTransport = ({model,snapshotId,identity,maxResponseBytes=SNAPSHOT_PAGE_LIMITS.responseBytes}) => {
  if(!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1024||maxResponseBytes>SNAPSHOT_PAGE_LIMITS.responseBytes)throw new Error('Snapshot responses require a finite budget up to 256 KiB.');
  let retired=false;
  let files=model.nodes||[],edges=model.edges||[];
  const metadata={...model};delete metadata.nodes;delete metadata.edges;
  const fileByPath=new Map(),memberById=new Map(),adjacency=new Map(),directories=new Map();
  let searchIndex=null;
  let members=0;
  const append=(key,row)=>{if(!adjacency.has(key))adjacency.set(key,[]);adjacency.get(key).push(row);};
  files.forEach((file,row)=>{
    const path=file.path||file.name;fileByPath.set(path,{file,row});
    const directory=path.replaceAll('\\','/').includes('/')?path.replaceAll('\\','/').split('/')[0]:'(root)';
    const aggregate=directories.get(directory)||{key:directory,label:directory,files:0,members:0};aggregate.files++;aggregate.members+=file.members?.length||0;directories.set(directory,aggregate);
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
    capabilities:{files:true,members:true,directedAdjacency:true,lazyDetail:true,demandPages:true,sourceQueryExpansion:false}};
  const directoryRows=[...directories.values()].sort((a,b)=>a.key.localeCompare(b.key,'en'));
  manifest.overview=directoryRows.length<=128&&Buffer.byteLength(JSON.stringify(directoryRows))<=64*1024
    ?directoryRows:[{key:'',label:'Available snapshot',files:files.length,members,all:true}];
  const foundEntity=entity=>{
    const pointer=entity?.address;
    if(pointer){
      if(!Number.isSafeInteger(pointer.fileRow)||pointer.fileRow<0||pointer.fileRow>=files.length)throw new Error('Invalid generation-local file address.');
      const file=files[pointer.fileRow],path=file.path||file.name;
      if(entity.type!=='member')return {file,row:pointer.fileRow};
      if(!Number.isSafeInteger(pointer.memberOrdinal)||pointer.memberOrdinal<0||pointer.memberOrdinal>=(file.members?.length||0))throw new Error('Invalid generation-local member address.');
      return {file:path,member:file.members[pointer.memberOrdinal],ordinal:pointer.memberOrdinal};
    }
    return entity?.type==='member'?memberById.get(sourceEntityKey('member',entity.id)):fileByPath.get(entity?.file);
  };
  const resolved=entity=>{
    const found=foundEntity(entity);
    if(!found||(entity.type==='member'&&entity.file&&entity.file!==found.file))throw new Error('Source identity unavailable in this snapshot.');
    const file=entity.type==='member'?fileByPath.get(found.file):found;
    const pointer={fileRow:file.row,...(entity.type==='member'?{memberOrdinal:found.ordinal}:{})};
    return {entity:entity.type==='member'?{...compactMember(found.member,found.file,found.ordinal),type:'member',address:pointer}
      :{type:'file',file:file.file.path||file.file.name,name:file.file.name||file.file.path,address:pointer},file:compactFile(file.file,file.row),ordinal:found.ordinal??null,found};
  };
  const owner=endpoint=>endpoint?.file||(endpoint?.member!=null?memberById.get(sourceEntityKey('member',endpoint.member))?.file:null);
  const endpointAddress=endpoint=>{
    if(endpoint?.member!=null){const found=memberById.get(sourceEntityKey('member',endpoint.member));if(!found||(endpoint.file&&endpoint.file!==found.file))return null;
      return {type:'member',address:{fileRow:fileByPath.get(found.file).row,memberOrdinal:found.ordinal}};}
    const found=fileByPath.get(endpoint?.file);return found?{type:'file',address:{fileRow:found.row}}:null;
  };
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
  return {manifest,getCompatibilityModel(){if(retired)throw new Error('Map snapshot transport has retired.');return {...metadata,nodes:files,edges};},
    respond(input){
      if(retired)throw new Error('Map snapshot transport has retired.');
      const request=snapshotRequest(input);
      if(input.protocol!==MAP_DATA_PROTOCOL||request.snapshot!==snapshotId)throw new Error('Requested map generation is unavailable in this pinned session.');
      if(request.kind==='manifest')return encode(wrap(request,{manifest}));
      if(request.kind==='files')return encode(wrap(request,page(request,files,compactFile)));
      if(request.kind==='resolve'){const {found,...value}=resolved(request.entity);return encode(wrap(request,value));}
      if(request.kind==='members'){
        const entry=request.fileRow!=null?foundEntity({type:'file',address:{fileRow:request.fileRow}}):fileByPath.get(request.file),file=entry?.file;
        if(!file)throw new Error('Source file unavailable in this snapshot.');
        return encode(wrap(request,page(request,file.members||[],(member,ordinal)=>({...compactMember(member,file.path||file.name,ordinal),address:{fileRow:entry.row,memberOrdinal:ordinal}}))));
      }
      if(request.kind==='edges')return encode(wrap(request,page(request,edges,(edge,row)=>({row,from:edge.from,to:edge.to,type:edge.type||'unknown'}))));
      if(request.kind==='adjacency'||request.kind==='adjacency-summary'){
        const selected=resolved(request.entity).entity,key=sourceEntityKey(selected.type,selected.type==='member'?selected.id:selected.file),rows=adjacency.get(key)||[];
        if(request.kind==='adjacency-summary'){
          let incoming=0,outgoing=0;
          const touches=endpoint=>selected.type==='member'?endpoint?.member===selected.id:owner(endpoint)===selected.file;
          for(const row of rows){if(touches(edges[row].from))outgoing++;if(touches(edges[row].to))incoming++;}
          return encode(wrap(request,{incoming,outgoing,total:rows.length,complete:true}));
        }
        return encode(wrap(request,page(request,rows,row=>({row,evidence:edges[row],owners:{from:owner(edges[row].from),to:owner(edges[row].to)},endpoints:{from:endpointAddress(edges[row].from),to:endpointAddress(edges[row].to)}}))));
      }
      if(request.kind==='detail'){
        const value=resolved(request.entity),found=value.found;
        return encode(wrap(request,{detail:value.entity.type==='member'?found.member:{...found.file,members:undefined,memberCount:found.file.members?.length||0},file:value.entity.file,ordinal:value.ordinal}));
      }
      if(request.kind==='search'){
        if(typeof request.query!=='string'||request.query.length>4096)throw new Error('Snapshot search query exceeds its text budget.');
        if(!searchIndex){
          searchIndex=createSnapshotSearchIndex();
          files.forEach((file,fileRow)=>{
            const path=file.path||file.name;
            searchIndex.admit('file',{search:`${path} ${file.name||''}`.toLowerCase(),info:{type:'file',file:path,name:file.name||path,memberCount:file.members?.length||0,address:{fileRow}}});
            (file.members||[]).forEach((member,memberOrdinal)=>{if(member.id!=null)searchIndex.admit('member',{search:`${path} ${member.name||''} ${member.kind||member.type||''} ${member.id}`.toLowerCase(),
              info:{type:'member',id:member.id,file:path,name:member.name,range:member.range,address:{fileRow,memberOrdinal}}});});
          });searchIndex.seal();
        }
        const query=request.query.trim().toLowerCase(),rows=[];let total=0,closed=false;
        for(const ordinal of searchIndex.candidates(query)){
          const {type,value}=searchIndex.row(ordinal);if((request.entityType&&type!==request.entityType)||!value.search.includes(query))continue;
          if(request.directory!=null){const path=value.info.file.replaceAll('\\','/'),directory=path.includes('/')?path.split('/')[0]:'(root)';if(directory!==request.directory)continue;}
          if(total>=request.cursor&&rows.length<request.limit&&!closed){
            const trial=wrap(request,{rows:[...rows,value.info],cursor:request.cursor,next:0,total:0,complete:true});
            if(Buffer.byteLength(JSON.stringify(trial))>maxResponseBytes-1024){if(!rows.length)throw new Error('Search result exceeds its response budget. Use the compatibility snapshot for this record.');closed=true;}else rows.push(value.info);
          }total++;
        }
        return encode(wrap(request,{rows,cursor:request.cursor,next:request.cursor+rows.length<total?request.cursor+rows.length:null,total,complete:true}));
      }
      throw new Error('Unsupported map snapshot operation.');
    },
    dispose(){retired=true;files=[];edges=[];fileByPath.clear();memberById.clear();adjacency.clear();directories.clear();searchIndex?.dispose();searchIndex=null;}
  };
};
