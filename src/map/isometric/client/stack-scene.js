import { state } from './state.js';
import { createShapeGeometry } from './layout.js';
import { createTextPlane, applyHeightFog } from './materials.js';
import { resolveStackTier, STACK_KINDS } from './stack-model.js';
import { projectPipeRows, projectViewerCoverage } from './coverage.js';
import { buildSpatialStackMeshes } from './rendering/stack-packet-adapter.js';
import { createRetainedPipeBuffer } from './rendering/retained-pipe-buffer.js';
import { pipeLane } from './rendering/pipe-semantics.js';
const categoryColors={source:'#426b90',test:'#8667b1',config:'#388b80',docs:'#b8884f',generated:'#596477',other:'#4a5c70'};
const edgeColors={import:'#76a9f0',export:'#b49bf4',call:'#61dbcf',usage:'#f3bd71',dataflow:'#ee8faa',alias:'#adb8cc'};
const material=color=>{const value=new state.THREE.MeshStandardMaterial({color,roughness:0.7,metalness:0.12});applyHeightFog(value);state.stackMaterials.push(value);return value;};
export function buildStackMeshes(){
  state.stackMaterials=[];
  state.stackPacketOwner=null;
  const {THREE,stackModel:model}=state,scale=state.scaleFactor||1,dummy=new THREE.Object3D();
  let members=0,labels=0;
  const label=(text,anchor,size,level)=>{
    if(!state.labelGroup.visible || labels>=(state.performance?.drawCaps?.labels??2000))return;
    const plane=createTextPlane(text,{size});plane.position.set(anchor.x,anchor.y,anchor.z);plane.quaternion.copy(state.camera.quaternion);
    plane.userData.stackLabelLevel=level;state.labelGroup.add(plane);labels++;
  };
  for(const group of model.groups){
    const tray=new THREE.Mesh(createShapeGeometry('square'),material('#1c2d40'));
    tray.position.set(group.x,-0.18*scale,group.z);tray.scale.set(group.width,0.16*scale,group.depth);tray.userData={type:'directory',group:group.key,skipPick:true};state.fileGroup.add(tray);
    label(group.key,{x:group.x,y:0.5*scale,z:group.z-group.depth/2},Math.min(group.width,8*scale),'pipeline');
  }
  if(state.stackPacketPolicy){
    state.stackPacketOwner=buildSpatialStackMeshes({model,policy:state.stackPacketPolicy,geometry:createShapeGeometry,material,
      fileColor:file=>new THREE.Color(categoryColors[file.node.category]||categoryColors.other)});
    for(const file of model.files)label(file.node.name||file.key.split('/').at(-1),{x:file.x,y:file.stackHeight+1.2*scale,z:file.z},Math.min(file.width,5*scale),'stacks');
    members=model.files.reduce((sum,file)=>sum+file.members.length,0);state.drawCounts={files:model.files.length,members,edges:0,labels};return;
  }
  for(const file of model.files){
    const color=new THREE.Color(categoryColors[file.node.category]||categoryColors.other);
    const base=new THREE.InstancedMesh(createShapeGeometry('square'),material('#ffffff'),1);
    dummy.position.set(file.x,file.height/2,file.z);dummy.scale.set(file.width,file.height,file.depth);dummy.updateMatrix();base.setMatrixAt(0,dummy.matrix);base.setColorAt(0,color);
    base.userData={type:'fileInstances',instanceInfo:[{type:'file',file:file.key,name:file.node.name||file.key,id:file.node.id??null,baseColor:color.clone(),x:file.x,y:file.height,z:file.z}]};
    state.fileGroup.add(base);state.fileInstancedMeshes.push(base);state.fileInstanceByKey.set(file.key,{mesh:base,instanceId:0});state.fileColorByPath.set(file.key,color);state.fileAnchors.set(file.key,{x:file.x,y:file.stackHeight,z:file.z});
    const cluster=new THREE.Group();state.memberGroup.add(cluster);state.memberClusters.push({group:cluster,sphere:new THREE.Sphere(new THREE.Vector3(file.x,file.stackHeight/2,file.z),Math.hypot(file.width/2,file.depth/2,file.stackHeight/2))});
    for(const kind of Object.keys(STACK_KINDS)){
      const rows=file.members.filter(row=>row.kind===kind);if(!rows.length)continue;
      const mesh=new THREE.InstancedMesh(createShapeGeometry(STACK_KINDS[kind].shape),material('#ffffff'),rows.length);
      mesh.userData={type:'memberInstances',file:file.key,instanceInfo:[]};cluster.add(mesh);state.memberInstancedMeshes.push(mesh);
      rows.forEach((row,index)=>{
        const point={x:file.x+row.x,y:row.y,z:file.z+row.z},color=new THREE.Color(row.color);
        dummy.position.set(point.x,point.y,point.z);dummy.scale.set(row.width,row.height,row.depth);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);mesh.setColorAt(index,color);
        mesh.userData.instanceInfo.push({type:'member',semanticKind:row.kind,file:file.key,id:row.member.id??null,address:row.member.address??null,name:row.member.name,range:row.member.range||null,baseColor:color.clone(),...point,footprint:row.width,height:row.height});
        if(row.id!==null){state.memberInstanceById.set(row.member.id,{mesh,instanceId:index});state.memberColorById.set(row.member.id,color);state.memberClusterByMemberId.set(row.member.id,cluster);state.memberAnchors.set(row.member.id,point);}
        members++;
      });
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();mesh.computeBoundingBox();
    }
    base.instanceMatrix.needsUpdate=true;if(base.instanceColor)base.instanceColor.needsUpdate=true;base.computeBoundingSphere();base.computeBoundingBox();
    label(file.node.name||file.key.split('/').at(-1),{x:file.x,y:file.stackHeight+1.2*scale,z:file.z},Math.min(file.width,5*scale),'stacks');
  }
  state.drawCounts={files:model.files.length,members,edges:0,labels};
}
function pipePositions(row,level,ordinal,scale,maxHeight){
  const positions=[],s=scale;
  const a=row.from,b=row.to,{railY,side,selfOffset}=pipeLane(row,level,ordinal,{scale,maxHeight});
  const points=[a,{x:a.x,y:railY,z:a.z},{x:a.x,y:railY,z:side},{x:b.x,y:railY,z:side},{x:b.x,y:railY,z:b.z},b];
  if(a.x===b.x&&a.z===b.z){points.splice(2,2,{x:a.x+selfOffset,y:railY,z:side},{x:a.x+selfOffset,y:railY,z:b.z});}
  for(let i=1;i<points.length;i++)positions.push(points[i-1].x,points[i-1].y,points[i-1].z,points[i].x,points[i].y,points[i].z);
  // Downward arrow at the target port preserves direction even for reciprocal pipes.
  positions.push(b.x-0.22*s,b.y+0.5*s,b.z,b.x,b.y,b.z,b.x+0.22*s,b.y+0.5*s,b.z,b.x,b.y,b.z);
  return positions;
}
const pipeOwner=layer=>{
  const {rows,level,scale,model}=layer;
  return createRetainedPipeBuffer({THREE:state.THREE,rows,positionsFor:(row,ordinal)=>pipePositions(row,level,ordinal,scale,model.bounds.maxHeight)});
};
const pipeMetrics=()=>{
  const metrics={geometryAllocations:0,geometryRetirements:0,attributeCapacityBytes:0,requestedUploadBytes:0,routeRowsComputed:0,unchangedSelections:0,activeVertices:0,gpuUploadBytes:null};
  for(const owner of state.stackPipeOwners||[])for(const key of Object.keys(metrics))if(key!=='gpuUploadBytes'&&key!=='activeVertices')metrics[key]+=owner.metrics[key];
  for(const layer of state.stackPipeLayers||[])if(layer.mesh?.visible&&layer.group.visible!==false&&state.edgeGroup.visible)metrics.activeVertices+=layer.mesh.geometry.drawRange.count;
  return metrics;
};
function setPipeRows(layer,rows){
  if(!rows.length){if(layer.mesh)layer.mesh.visible=false;return;}
  layer.owner.select(rows,{publish:geometry=>{
    if(!layer.mesh){
      const material=new state.THREE.LineBasicMaterial({color:state.map?.legend?.edgeStyles?.[layer.type]?.color||edgeColors[layer.type]||'#adb8cc',transparent:true,opacity:0.8,depthWrite:false});
      try{layer.mesh=new state.THREE.LineSegments(geometry,material);layer.mesh.userData={stackLevel:layer.level,edgeType:layer.type};layer.group.add(layer.mesh);}
      catch(error){material.dispose();layer.mesh=null;throw error;}
    }else layer.mesh.geometry=geometry;
  }});
  layer.mesh.visible=true;
}
export function buildStackPipes(){
  const {THREE,stackModel:model}=state;state.stackPipeLayers=[];state.stackPipeOwners=[];state.stackVisibilityKey=null;
  const types=[...new Set((state.residentEdges||state.edges).map(row=>row.type||'unknown'))].sort();state.edgeTypes=types;
  for(const type of types){
    const group=new THREE.Group();group.visible=state.edgeVisibility.get(type)!==false;state.edgeGroup.add(group);state.edgeTypeGroups.set(type,group);
    for(const level of ['pipeline','stacks','segments']){
      const rows=model.levels[level].filter(row=>row.type===type);if(!rows.length)continue;
      const layer={mesh:null,rows,level,type,group,model,scale:state.scaleFactor||1};
      layer.owner=pipeOwner(layer);state.stackPipeOwners.push(layer.owner);state.stackPipeLayers.push(layer);
    }
  }
  state.drawCounts.edges=model.levels.segments.length;
  updateStackVisibility(true);
}
export function updateStackVisibility(force=false){
  if(!state.stackModel)return;
  const width=state.getViewport?.().width||1200;
  const sample=state.stackModel.files[0]?.width||1;
  const pixels=sample*width*state.camera.zoom/Math.max(1,state.camera.right-state.camera.left);
  const tier=resolveStackTier({projectedFilePixels:pixels,mode:state.stackMode||'auto',previous:state.stackTier});
  const selected=state.selectedInfo,focus=selected?.file||null,member=selected?.type==='member'?selected.id:null;
  const key=JSON.stringify([tier,focus,member,state.stackAllConnections===true,state.scaleFactor||1,
    state.edgeGroup.userData?.userHidden,state.memberGroup.userData?.userHidden,state.labelGroup.userData?.userHidden,[...state.edgeVisibility.entries()]]);
  if(!force&&key===state.stackVisibilityKey&&state.stackVisibilityModel===state.stackModel)return;
  state.stackTier=tier;
  state.edgeGroup.visible=state.edgeGroup.userData?.userHidden!==true;
  const memberHidden=state.memberGroup.userData?.userHidden===true;state.memberGroup.visible=!memberHidden;
  // Keep the stack silhouette at every scale; only connections and labels change semantic resolution.
  let admitted=0,represented=0;const visibleRows=[];
  for(const layer of state.stackPipeLayers||[]){
    const wasVisible=layer.mesh?.visible;
    if(layer.mesh)layer.mesh.visible=false;
    if(layer.level!==tier||!state.edgeGroup.visible||layer.group.visible===false||state.edgeVisibility.get(layer.type)===false)continue;
    let previous=null;
    if(layer.model!==state.stackModel||layer.scale!==(state.scaleFactor||1)){
      previous={rows:layer.rows,model:layer.model,scale:layer.scale,owner:layer.owner};
      layer.rows=state.stackModel.levels[layer.level].filter(row=>row.type===layer.type);
      layer.model=state.stackModel;layer.scale=state.scaleFactor||1;layer.owner=pipeOwner(layer);
    }
    const adjacent=tier==='segments'&&selected&&state.stackAllConnections!==true
      ? state.stackModel.adjacency?.[tier]?.get(JSON.stringify([selected.type==='member'?'member':'file',selected.type==='member'?selected.id:selected.file])) : null;
    const sourceRows=adjacent?adjacent.filter(row=>row.type===layer.type):layer.rows;
    const topologyRows=projectPipeRows(sourceRows,{level:layer.level,tier,selected,allConnections:state.stackAllConnections===true});
    try{setPipeRows(layer,topologyRows);}
    catch(error){
      if(previous){layer.owner.dispose();Object.assign(layer,previous);}
      if(layer.mesh)layer.mesh.visible=wasVisible;
      throw error;
    }
    if(previous){state.stackPipeOwners[state.stackPipeOwners.indexOf(previous.owner)]=layer.owner;previous.owner.dispose();}
    const rows=topologyRows;
    admitted+=rows.length;represented+=rows.reduce((sum,row)=>sum+row.count,0);
    visibleRows.push(...rows);
  }
  for(const label of state.labelGroup.children)label.visible=label.userData.stackLabelLevel==='pipeline'||tier!=='pipeline';
  state.stackVisibleRows=visibleRows;
  state.pipeBufferMetrics=pipeMetrics();
  state.stackVisibilityKey=key;state.stackVisibilityModel=state.stackModel;
  state.viewerCoverage=projectViewerCoverage(state,{pipes:admitted,relations:represented});
  const omitted=state.stackModel.coverage;
  const status=document.getElementById('stack-status');if(status&&!state.preparingScene){status.textContent=`${tier} · ${admitted} visible pipes / ${represented} source relations · drawn ${state.drawCounts.files} files / ${state.drawCounts.members} members · draw omitted ${omitted.omittedFiles} files / ${omitted.omittedMembers} members / ${omitted.omittedEdges} edges · ${omitted.unresolvedEdges} unresolved · ${omitted.nonresidentMemberEdges||0} relations await resident member detail · available snapshot only`;status.title=JSON.stringify(state.viewerCoverage);}
}
