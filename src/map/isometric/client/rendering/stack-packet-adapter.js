import { state } from '../state.js';
import { planSpatialDrawPackets, createInstanceSlotTable } from './draw-packets.js';
import { markInstanceRange } from './attribute-ranges.js';
import { retirePicking } from './picking-owner.js';
import { setSelection, setSemanticSelection } from '../selection.js';
import { sourceEntityKey } from '../data/protocol.js';

/** Candidate Three adapter. No batch policy is selected by default. */
export const buildSpatialStackMeshes = ({model,policy,geometry,material,fileColor}) => {
  const plan=planSpatialDrawPackets(model,policy),{THREE}=state;
  const dummy=new THREE.Object3D(),hidden=new THREE.Matrix4().makeScale(0,0,0),materials=new Map(),packets=new Map();
  const metrics={attributeCapacityBytes:plan.attributeBytes,bufferAllocations:plan.packets.length*2,packetObjects:plan.packets.length,
    instanceRows:plan.instanceCount,requestedAttributeBytes:0,attributeRangeWrites:0,residencyChurn:0,drawSubmissions:null,acceptance:'candidate-unqualified'};
  let retired=false;
  const appearance=row=>row.color?new THREE.Color(row.color):fileColor(row.file);
  const info=row=>row.entity?.type==='file'
    ? {...row.entity,name:row.node.name||row.file.key,id:row.node.id??null,baseColor:appearance(row),x:row.position[0],y:row.file.height,z:row.position[2]}
    : {type:'member',id:row.entity?.id??null,file:row.file.key,name:row.segment.member.name,semanticKind:row.segment.kind,
      range:row.segment.member.range??null,baseColor:appearance(row),x:row.position[0],y:row.position[1],z:row.position[2],footprint:row.scale[0],height:row.scale[1]};
  const references=row=>row.entity?.type==='file'?state.fileInstanceByKey:state.memberInstanceById;
  const referenceKey=row=>row.entity?.type==='file'?row.entity.file:row.entity?.id;
  const install=(packet,row,slot)=>{
    if(!row.entity)return;
    references(row).set(referenceKey(row),{mesh:packet.mesh,instanceId:slot});
    if(row.entity.type==='file'){
      state.fileColorByPath.set(row.entity.file,appearance(row));state.fileAnchors.set(row.entity.file,{x:row.position[0],y:row.file.stackHeight,z:row.position[2]});
    }else{
      const key=row.entity.id;state.memberColorById.set(key,appearance(row));state.memberAnchors.set(key,{x:row.position[0],y:row.position[1],z:row.position[2]});
      state.memberClusterByMemberId.set(key,packet.group);
    }
  };
  const uninstall=(packet,row)=>{
    if(!row?.entity)return;
    const key=referenceKey(row),map=references(row);
    // A moved entity may already belong to another committed packet.
    if(map.get(key)?.mesh!==packet.mesh)return;
    map.delete(key);
    if(row.entity.type==='file'){state.fileColorByPath.delete(key);state.fileAnchors.delete(key);}
    else{state.memberColorById.delete(key);state.memberAnchors.delete(key);state.memberClusterByMemberId.delete(key);}
  };
  const sameVector=(left,right)=>left?.length===right?.length&&left.every((value,index)=>value===right[index]);
  const write=(packet,slot,row,previous=null)=>{
    const transform=!row||!previous||!sameVector(row.position,previous.position)||!sameVector(row.scale,previous.scale);
    if(row){
      if(transform){dummy.position.fromArray(row.position);dummy.scale.fromArray(row.scale);dummy.updateMatrix();packet.mesh.setMatrixAt(slot,dummy.matrix);}
      if(!previous||row.color!==previous.color){packet.mesh.setColorAt(slot,appearance(row));markInstanceRange(packet.mesh.instanceColor,slot,3,metrics);}
      packet.mesh.userData.instanceInfo[slot]=info(row);
    }else{packet.mesh.setMatrixAt(slot,hidden);packet.mesh.userData.instanceInfo[slot]=null;}
    if(transform)markInstanceRange(packet.mesh.instanceMatrix,slot,16,metrics);
  };
  const apply=(packet,rows)=>{
    const delta=packet.slots.prepare(rows);
    // No await or externally visible slot map changes during publication.
    try{for(const change of delta.changed)write(packet,change.slot,change.next,change.previous);}
    catch(error){for(const change of delta.changed)write(packet,change.slot,change.previous);throw error;}
    for(const change of delta.changed)uninstall(packet,change.previous);
    packet.slots.commit(delta);
    for(const change of delta.changed)if(change.next)install(packet,change.next,change.slot);
    packet.mesh.count=Math.max(0,...[...packet.slots.entries()].map(([,value])=>value.slot+1));
    packet.mesh.computeBoundingBox();packet.mesh.computeBoundingSphere();
    if(packet.cluster)packet.cluster.sphere.copy(packet.mesh.boundingSphere);
    metrics.residencyChurn+=delta.changed.length;return delta;
  };
  try{
    for(const descriptor of plan.packets){
      const key=JSON.stringify(descriptor.compatibility);let shared=materials.get(key);
      if(!shared){shared=material('#ffffff');shared.userData={...shared.userData,shared:true,packetOwned:true};materials.set(key,shared);}
      const mesh=new THREE.InstancedMesh(geometry(descriptor.compatibility.shape),shared,descriptor.capacity);
      const group=new THREE.Group();group.add(mesh);
      const layer=descriptor.compatibility.layer;
      mesh.userData={type:layer==='file'?'fileInstances':'memberInstances',instanceInfo:[],packetId:descriptor.id};
      const packet={...descriptor,mesh,group,slots:createInstanceSlotTable(descriptor.capacity)};packets.set(descriptor.id,packet);
      (layer==='file'?state.fileGroup:state.memberGroup).add(group);
      (layer==='file'?state.fileInstancedMeshes:state.memberInstancedMeshes).push(mesh);
      if(layer==='member'){packet.cluster={group,sphere:new THREE.Sphere()};state.memberClusters.push(packet.cluster);}
      apply(packet,descriptor.rows);
    }
  }catch(error){for(const packet of packets.values())packet.slots.dispose();for(const value of materials.values())value.dispose();throw error;}
  const owner={plan,packets,metrics,
    updatePacket(id,rows,expectedRevision){
      if(retired)throw new Error('Spatial packet owner has retired.');
      const packet=packets.get(id);if(!packet||packet.slots.revision!==expectedRevision)throw new Error('Packet delta targets a retired or changed slot revision.');
      const current=new Set([...packet.slots.entries()].map(([key])=>key));
      if(rows.length!==current.size||rows.some(row=>!current.has(row.sourceKey)))throw new Error('Membership/eviction changes require a new bounded scene transaction, including dependency geometry.');
      const own=packet.compatibility;
      for(const row of rows){const cell=row.position.map(value=>Math.floor(value/policy.cellSize));
        if(row.entity&&(!state.sourceIndex?.resolve(row.entity)||row.sourceKey!==sourceEntityKey(row.entity.type,row.entity.type==='member'?row.entity.id:row.entity.file)))throw new Error('Packet delta requires an available canonical source identity.');
        if(JSON.stringify(cell)!==JSON.stringify(packet.cell)||(row.entity?.type==='file'?'file':'member')!==own.layer||(row.segment?.shape||'square')!==own.shape)throw new Error('Cross-cell or incompatible delta requires a new bounded packet transaction.');}
      const delta=apply(packet,rows);retirePicking();state.geometryRevision=(state.geometryRevision||0)+1;
      state.viewRevisions?.bump('residency');
      const selected=state.selectedInfo;if(selected){const ref=selected.type==='member'?state.memberInstanceById.get(selected.id):state.fileInstanceByKey.get(selected.file);if(ref)setSelection({object:ref.mesh,instanceId:ref.instanceId});else setSemanticSelection(selected);}
      state.invalidateHover?.();state.invalidateRender?.();return {revision:packet.slots.revision,changedSlots:delta.changed.length,metrics:{...metrics}};
    },
    setSurfaceOpacity(layer,opacity){for(const packet of packets.values())if(packet.compatibility.layer===layer){packet.compatibility.alphaMode=opacity<1?'blend':'opaque';packet.compatibility.opacity=opacity;}},
    dispose(){if(retired)return;retired=true;for(const packet of packets.values())packet.slots.dispose();packets.clear();for(const value of materials.values())value.dispose();materials.clear();}
  };
  return owner;
};
