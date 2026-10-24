import { setImmediate } from 'node:timers/promises';
import { createSnapshotRowByteBudget } from './map-snapshot-page-budget.js';

/** Source-order records are transient; no second whole-source key table. */
export function* snapshotSearchRecords(files,{includeAnonymous=false}={}){
  for(let fileRow=0;fileRow<files.length;fileRow++){
    const file=files[fileRow],path=file.path||file.name;
    yield {type:'file',search:`${path} ${file.name||''}`.toLowerCase(),info:{type:'file',file:path,name:file.name||path,memberCount:file.members?.length||0,address:{fileRow}}};
    for(let memberOrdinal=0;memberOrdinal<(file.members?.length||0);memberOrdinal++){
      const member=file.members[memberOrdinal];if(member.id==null){if(includeAnonymous)yield null;continue;}
      yield {type:'member',search:`${path} ${member.name||''} ${member.kind||member.type||''} ${member.id}`.toLowerCase(),
        info:{type:'member',id:member.id,file:path,name:member.name,range:member.range,address:{fileRow,memberOrdinal}}};
    }
  }
}

/** Both local transport modes use exactly the same query/scope semantics. */
export const prepareSnapshotSearch = request => {
  if(typeof request.query!=='string'||request.query.length>4096)throw new Error('Snapshot search query exceeds its text budget.');
  if(request.entityType!=null&&!['file','member'].includes(request.entityType))throw new Error('Unsupported snapshot search entity type.');
  if(request.directory!=null&&(typeof request.directory!=='string'||request.directory.length>4096))throw new Error('Invalid snapshot search directory scope.');
  const query=request.query.trim().toLowerCase();
  return {query,matches(value,type=value?.type){
    if(!value||(request.entityType&&type!==request.entityType)||!value.search.includes(query))return false;
    if(request.directory!=null){const path=value.info.file.replaceAll('\\','/'),directory=path.includes('/')?path.split('/')[0]:'(root)';if(directory!==request.directory)return false;}
    return true;
  }};
};

export const createSnapshotSearchPage = ({request,wrap,maxResponseBytes}) => {
  const rows=[];let total=0,closed=false;
  const budget=createSnapshotRowByteBudget({maxResponseBytes,
    emptyEnvelope:wrap(request,{rows:[],cursor:request.cursor,next:Number.MAX_SAFE_INTEGER,total:Number.MAX_SAFE_INTEGER,complete:true})});
  return {
    admit(info){
      if(total>=request.cursor&&rows.length<request.limit&&!closed){
        if(!budget.admit(info)){if(!rows.length)throw new Error('Search result exceeds its response budget. Use the compatibility snapshot for this record.');closed=true;}
        else rows.push(info);
      }
      total++;
    },
    finish(){
      if(request.cursor>total)throw new Error('Snapshot search cursor exceeds its pinned matching total.');
      return {rows,cursor:request.cursor,next:request.cursor+rows.length<total?request.cursor+rows.length:null,total,complete:true};
    }
  };
};

/** Exact available-snapshot totals, bounded result page and actual cancellation. */
export const searchMapSnapshotRows = async ({files,request,wrap,maxResponseBytes,signal,yieldControl=()=>setImmediate()}) => {
  signal?.throwIfAborted();
  const search=prepareSnapshotSearch(request),page=createSnapshotSearchPage({request,wrap,maxResponseBytes});let visited=0;
  for(const value of snapshotSearchRecords(files,{includeAnonymous:true})){
    signal?.throwIfAborted();
    if(++visited%128===0){await yieldControl();signal?.throwIfAborted();}
    if(!search.matches(value))continue;
    page.admit(value.info);
  }
  signal?.throwIfAborted();
  return page.finish();
};
