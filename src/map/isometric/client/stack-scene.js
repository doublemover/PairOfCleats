import { state } from './state.js';
import { createShapeGeometry } from './layout.js';
import { createTextPlane, applyHeightFog } from './materials.js';
import { resolveStackTier, STACK_KINDS } from './stack-model.js';
import { projectPipeRows, projectViewerCoverage } from './coverage.js';
const categoryColors={source:'#426b90',test:'#8667b1',config:'#388b80',docs:'#b8884f',generated:'#596477',other:'#4a5c70'};
const edgeColors={import:'#76a9f0',export:'#b49bf4',call:'#61dbcf',usage:'#f3bd71',dataflow:'#ee8faa',alias:'#adb8cc'};
const material=color=>{const value=new state.THREE.MeshStandardMaterial({color,roughness:0.7,metalness:0.12});applyHeightFog(value);state.stackMaterials.push(value);return value;};
export function buildStackMeshes(){
  state.stackMaterials=[];
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
        mesh.userData.instanceInfo.push({type:'member',semanticKind:row.kind,file:file.key,id:row.id,name:row.member.name,range:row.member.range||null,baseColor:color.clone(),...point,footprint:row.width,height:row.height});
        if(row.id!==null){state.memberInstanceById.set(row.id,{mesh,instanceId:index});state.memberColorById.set(row.id,color);state.memberClusterByMemberId.set(row.id,cluster);state.memberAnchors.set(row.id,point);}
        members++;
      });
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();mesh.computeBoundingBox();
    }
    base.instanceMatrix.needsUpdate=true;if(base.instanceColor)base.instanceColor.needsUpdate=true;base.computeBoundingSphere();base.computeBoundingBox();
    label(file.node.name||file.key.split('/').at(-1),{x:file.x,y:file.stackHeight+1.2*scale,z:file.z},Math.min(file.width,5*scale),'stacks');
  }
  state.drawCounts={files:model.files.length,members,edges:0,labels};
}
function pipePositions(rows,level){
  const positions=[],s=state.scaleFactor||1,top=state.stackModel.bounds.maxHeight;
  rows.forEach((row,index)=>{
    const a=row.from,b=row.to,lane=(index%5)*0.2*s;
    const railY=level==='pipeline'?top+3*s+lane:Math.max(a.y,b.y)+1.5*s+lane;
    const side=Math.max(a.z,b.z)+2*s+lane;
    const points=[a,{x:a.x,y:railY,z:a.z},{x:a.x,y:railY,z:side},{x:b.x,y:railY,z:side},{x:b.x,y:railY,z:b.z},b];
    if(a.x===b.x&&a.z===b.z){points.splice(2,2,{x:a.x+2*s,y:railY,z:side},{x:a.x+2*s,y:railY,z:b.z});}
    for(let i=1;i<points.length;i++)positions.push(points[i-1].x,points[i-1].y,points[i-1].z,points[i].x,points[i].y,points[i].z);
    // Downward arrow at the target port preserves direction even for reciprocal pipes.
    positions.push(b.x-0.22*s,b.y+0.5*s,b.z,b.x,b.y,b.z,b.x+0.22*s,b.y+0.5*s,b.z,b.x,b.y,b.z);
  });return positions;
}
const pipeGeometry=(rows,level)=>{
  const geometry=new state.THREE.BufferGeometry();
  geometry.setAttribute('position',new state.THREE.Float32BufferAttribute(pipePositions(rows,level),3));
  return geometry;
};
const sameRows=(left,right)=>left===right||(left?.length===right?.length&&left.every((row,index)=>row===right[index]));
function setPipeRows(layer,rows){
  if(sameRows(layer.geometryRows,rows))return;
  const previous=layer.subsetGeometry;
  layer.subsetGeometry=rows===layer.rows?null:pipeGeometry(rows,layer.level);
  layer.mesh.geometry=layer.subsetGeometry||layer.fullGeometry;
  layer.geometryRows=rows;
  if(previous){layer.mesh.userData.ownedGeometries.delete(previous);previous.dispose();}
  if(layer.subsetGeometry)layer.mesh.userData.ownedGeometries.add(layer.subsetGeometry);
}
export function buildStackPipes(){
  const {THREE,stackModel:model}=state;state.stackPipeLayers=[];state.stackVisibilityKey=null;
  const types=[...new Set(state.edges.map(row=>row.type||'unknown'))].sort();state.edgeTypes=types;
  for(const type of types){
    const group=new THREE.Group();group.visible=state.edgeVisibility.get(type)!==false;state.edgeGroup.add(group);state.edgeTypeGroups.set(type,group);
    for(const level of ['pipeline','stacks','segments']){
      const rows=model.levels[level].filter(row=>row.type===type);if(!rows.length)continue;
      const geometry=pipeGeometry(rows,level);
      const mesh=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:state.map?.legend?.edgeStyles?.[type]?.color||edgeColors[type]||'#adb8cc',transparent:true,opacity:0.8,depthWrite:false}));
      mesh.userData={stackLevel:level,edgeType:type,ownedGeometries:new Set([geometry])};
      group.add(mesh);state.stackPipeLayers.push({mesh,rows,level,type,fullGeometry:geometry,subsetGeometry:null,geometryRows:rows,
        model,scale:state.scaleFactor||1});
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
  const selected=state.selectedInfo,focus=selected?.file||null,member=selected?.type==='member'?String(selected.id):null;
  const key=JSON.stringify([tier,focus,member,state.stackAllConnections===true,state.scaleFactor||1,
    state.edgeGroup.userData?.userHidden,state.memberGroup.userData?.userHidden,state.labelGroup.userData?.userHidden,[...state.edgeVisibility.entries()]]);
  if(!force&&key===state.stackVisibilityKey&&state.stackVisibilityModel===state.stackModel)return;
  state.stackVisibilityKey=key;state.stackVisibilityModel=state.stackModel;state.stackTier=tier;
  state.edgeGroup.visible=state.edgeGroup.userData?.userHidden!==true;
  const memberHidden=state.memberGroup.userData?.userHidden===true;state.memberGroup.visible=!memberHidden;
  // Keep the stack silhouette at every scale; only connections and labels change semantic resolution.
  let admitted=0,represented=0;const visibleRows=[];
  for(const layer of state.stackPipeLayers||[]){
    layer.mesh.visible=layer.level===tier;
    if(!layer.mesh.visible)continue;
    if(layer.model!==state.stackModel||layer.scale!==(state.scaleFactor||1)){
      for(const geometry of layer.mesh.userData.ownedGeometries)geometry.dispose();
      layer.mesh.userData.ownedGeometries.clear();
      layer.rows=state.stackModel.levels[layer.level].filter(row=>row.type===layer.type);
      layer.fullGeometry=pipeGeometry(layer.rows,layer.level);layer.subsetGeometry=null;
      layer.mesh.geometry=layer.fullGeometry;layer.mesh.userData.ownedGeometries.add(layer.fullGeometry);
      layer.geometryRows=layer.rows;layer.model=state.stackModel;layer.scale=state.scaleFactor||1;
    }
    const topologyRows=projectPipeRows(layer.rows,{level:layer.level,tier,selected,allConnections:state.stackAllConnections===true});
    setPipeRows(layer,topologyRows);
    const rows=state.edgeGroup.visible&&layer.mesh.parent?.visible!==false&&state.edgeVisibility.get(layer.type)!==false?topologyRows:[];
    admitted+=rows.length;represented+=rows.reduce((sum,row)=>sum+row.count,0);
    visibleRows.push(...rows);
  }
  for(const label of state.labelGroup.children)label.visible=label.userData.stackLabelLevel==='pipeline'||tier!=='pipeline';
  state.stackVisibleRows=visibleRows;
  state.viewerCoverage=projectViewerCoverage(state,{pipes:admitted,relations:represented});
  const omitted=state.stackModel.coverage;
  const status=document.getElementById('stack-status');if(status){status.textContent=`${tier} · ${admitted} visible pipes / ${represented} source relations · drawn ${state.drawCounts.files} files / ${state.drawCounts.members} members · draw omitted ${omitted.omittedFiles} files / ${omitted.omittedMembers} members / ${omitted.omittedEdges} edges · ${omitted.unresolvedEdges} unresolved · available snapshot only`;status.title=JSON.stringify(state.viewerCoverage);}
}
