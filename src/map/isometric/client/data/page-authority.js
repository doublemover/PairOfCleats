import { MAP_DATA_PROTOCOL, SNAPSHOT_PAGE_LIMITS } from './protocol.js';

const integer=value=>Number.isSafeInteger(value)&&value>=0;
const pageKinds=new Set(['files','members','edges','adjacency','search']);
const fail=message=>{throw new Error(`Invalid pinned map page: ${message}`);};

export const validateSnapshotManifest = (manifest,snapshot) => {
  if(manifest?.snapshot!==snapshot||manifest.protocol!==MAP_DATA_PROTOCOL
    ||['files','members','edges'].some(key=>!integer(manifest.counts?.[key])))fail('manifest generation/counts mismatch.');
  if(manifest.overview!==undefined){
    if(!Array.isArray(manifest.overview))fail('overview must contain source aggregates.');
    const keys=new Set();let files=0,members=0;
    for(const row of manifest.overview){
      if(typeof row.key!=='string'||keys.has(row.key)||!integer(row.files)||!integer(row.members))fail('invalid overview aggregate identity/count.');
      keys.add(row.key);files+=row.files;members+=row.members;
    }
    if(files!==manifest.counts.files||members!==manifest.counts.members)fail('overview does not preserve available source totals.');
  }
  return manifest;
};

/** Validate source-local addresses and exact continuation before cache admission. */
export const validateSnapshotPage = (page,request,manifest) => {
  if(!pageKinds.has(request.kind))return page;
  if(!Array.isArray(page.rows)||page.rows.length>request.limit||page.rows.length>SNAPSHOT_PAGE_LIMITS.rows
    ||!integer(page.total)||page.cursor!==request.cursor||page.cursor>page.total)fail('cursor, row count or total mismatch.');
  const end=page.cursor+page.rows.length;
  if(end>page.total||(page.next===null?end!==page.total:page.next!==end||page.next<=page.cursor))fail('continuation did not advance exactly.');
  const maximum=request.kind==='files'?manifest.counts.files:request.kind==='members'?manifest.counts.members
    :request.kind==='search'?manifest.counts.files+manifest.counts.members:manifest.counts.edges;
  if(page.total>maximum||(request.kind==='files'&&page.total!==maximum)||(request.kind==='edges'&&page.total!==maximum))fail('page total exceeds or changes pinned source counts.');
  for(let offset=0;offset<page.rows.length;offset++){
    const row=page.rows[offset],ordinal=page.cursor+offset;
    if(!row||typeof row!=='object')fail('source row is not an object.');
    if(request.kind==='files'){
      if(row.row!==ordinal||typeof row.path!=='string'||!row.path||!integer(row.memberCount)||row.memberCount>manifest.counts.members)fail('file row address/count mismatch.');
    }else if(request.kind==='members'){
      if(row.ordinal!==ordinal||row.address?.memberOrdinal!==ordinal||!integer(row.address?.fileRow)||row.address.fileRow>=manifest.counts.files
        ||(request.fileRow!=null&&row.address.fileRow!==request.fileRow)||(request.file!=null&&row.file!==request.file))fail('member row owner/address mismatch.');
    }else if(request.kind==='edges'||request.kind==='adjacency'){
      if(!integer(row.row)||row.row>=manifest.counts.edges||(request.kind==='edges'&&row.row!==ordinal))fail('relationship row address mismatch.');
      if(request.kind==='adjacency'&&(!row.evidence||typeof row.evidence!=='object'))fail('relationship evidence is unavailable.');
    }else{
      const pointer=row.address;
      if(!['file','member'].includes(row.type)||!integer(pointer?.fileRow)||pointer.fileRow>=manifest.counts.files
        ||(row.type==='member'&&!integer(pointer.memberOrdinal)))fail('search result address mismatch.');
    }
  }
  return page;
};

export const validateResolvedSnapshotEntity = (record,manifest) => {
  const {entity,file,ordinal}=record,pointer=entity?.address;
  if(!entity||!['file','member'].includes(entity.type)||typeof entity.file!=='string'||!file||file.path!==entity.file
    ||!integer(file.row)||file.row>=manifest.counts.files||pointer?.fileRow!==file.row||!integer(file.memberCount)||file.memberCount>manifest.counts.members)fail('resolved file identity/address mismatch.');
  if(entity.type==='member'&&(!integer(ordinal)||ordinal>=file.memberCount||entity.ordinal!==ordinal||pointer.memberOrdinal!==ordinal))fail('resolved member ordinal mismatch.');
  return record;
};

/** Cached evidence cannot be mutated by a renderer or inspector consumer. */
export const freezeSnapshotResponse = value => {
  const pending=[value],seen=new WeakSet();
  while(pending.length){const current=pending.pop();if(!current||typeof current!=='object'||seen.has(current))continue;
    seen.add(current);for(const child of Object.values(current))if(child&&typeof child==='object')pending.push(child);Object.freeze(current);
  }
  return value;
};
