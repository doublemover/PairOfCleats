import { sourceEntityKey } from '../data/protocol.js';

export const validatePacketPolicy = policy => {
  if(!policy||!Number.isFinite(policy.cellSize)||policy.cellSize<=0||!Number.isInteger(policy.maxInstances)||policy.maxInstances<1
    ||!Number.isInteger(policy.maxPackets)||policy.maxPackets<1||!Number.isSafeInteger(policy.maxAttributeBytes)||policy.maxAttributeBytes<1)throw new Error('Spatial packet candidate requires explicit finite cell, instance, packet and attribute-byte budgets.');
  return {...policy};
};

/** Backend-neutral candidate: source identity, dense row and slot are distinct. */
export const planSpatialDrawPackets = (model,policy) => {
  const effective=validatePacketPolicy(policy),cells=new Map();let rowIndex=0,instanceCount=0,attributeBytes=0;
  const admit=(row,compatibility)=>{
    const cell=row.position.map(value=>Math.floor(value/effective.cellSize));
    const key=JSON.stringify([cell,compatibility]);
    if(!cells.has(key))cells.set(key,{cell,compatibility,rows:[]});
    cells.get(key).rows.push({...row,rowIndex:rowIndex++});instanceCount++;
  };
  for(const file of model.files){
    admit({entity:{type:'file',file:file.key},sourceKey:sourceEntityKey('file',file.key),position:[file.x,file.height/2,file.z],
      scale:[file.width,file.height,file.depth],color:null,file,node:file.node},
    {layer:'file',shape:'square',surface:'file-core',alphaMode:'opaque',depthTest:true,depthWrite:true});
    for(const row of file.members){
      const semantic=row.member.id==null?null:{type:'member',id:row.member.id,file:file.key};
      admit({entity:semantic,sourceKey:semantic?sourceEntityKey('member',semantic.id):JSON.stringify(['render-only',file.key,row.ordinal]),
        position:[file.x+row.x,row.y,file.z+row.z],scale:[row.width,row.height,row.depth],color:row.color,file,segment:row},
      {layer:'member',shape:row.shape,surface:'semantic-core',alphaMode:'opaque',depthTest:true,depthWrite:true});
    }
  }
  const packets=[];
  for(const [cellKey,cell]of cells){
    for(let offset=0;offset<cell.rows.length;offset+=effective.maxInstances){
      const rows=cell.rows.slice(offset,offset+effective.maxInstances),capacity=Math.min(effective.maxInstances,2**Math.ceil(Math.log2(rows.length)));
      const bytes=capacity*(16+3)*Float32Array.BYTES_PER_ELEMENT;
      attributeBytes+=bytes;
      if(packets.length>=effective.maxPackets||attributeBytes>effective.maxAttributeBytes)throw new Error('Spatial packet candidate exceeds its explicit resident allocation budget; prior scene remains usable.');
      packets.push({id:JSON.stringify([cellKey,offset/effective.maxInstances]),cell:cell.cell,compatibility:cell.compatibility,rows,capacity,attributeBytes:bytes});
    }
  }
  return {policy:effective,packets,instanceCount,attributeBytes,sourceRows:rowIndex,
    acceptance:'candidate-unqualified',sourceCoverage:model.coverage};
};

/** Transactional slot compaction never mutates canonical keys. */
export const createInstanceSlotTable = capacity => {
  if(!Number.isInteger(capacity)||capacity<1)throw new Error('Finite instance slot capacity required.');
  let revision=0,retired=false,accepted=new Map();
  return {
    prepare(rows){
      if(retired)throw new Error('Instance slot table has retired.');
      if(rows.length>capacity)throw new Error('Instance delta exceeds retained capacity.');
      const desired=new Map();for(const row of rows){if(desired.has(row.sourceKey))throw new Error('Duplicate canonical entity in packet.');desired.set(row.sourceKey,row);}
      const next=new Map(),free=[];const used=new Set();
      for(const [key,value]of accepted)if(desired.has(key)){next.set(key,{slot:value.slot,row:desired.get(key)});used.add(value.slot);}
      for(let slot=0;slot<capacity;slot++)if(!used.has(slot))free.push(slot);
      for(const [key,row]of desired)if(!next.has(key))next.set(key,{slot:free.shift(),row});
      const changed=[],oldSlots=new Map([...accepted.values()].map(value=>[value.slot,value.row])),newSlots=new Map([...next.values()].map(value=>[value.slot,value.row]));
      for(const slot of new Set([...oldSlots.keys(),...newSlots.keys()]))if(oldSlots.get(slot)!==newSlots.get(slot))changed.push({slot,previous:oldSlots.get(slot)||null,next:newSlots.get(slot)||null});
      return {baseRevision:revision,next,changed,removed:[...accepted.keys()].filter(key=>!next.has(key))};
    },
    commit(delta){if(retired||delta.baseRevision!==revision)throw new Error('Stale instance-slot delta.');accepted=delta.next;return ++revision;},
    entries(){return accepted.entries();},get revision(){return revision;},
    dispose(){retired=true;accepted.clear();revision++;}
  };
};
