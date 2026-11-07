import { createSpatialBoundsIndex } from './spatial-bounds.js';

const visible=object=>{for(let current=object;current;current=current.parent)if(current.visible===false)return false;return true;};

/** Exact CPU picking for candidate slots, without mutating a live batch. */
export const createInstancePickIndex = ({THREE,meshes,...options}) => {
  const records=[],matrix=new THREE.Matrix4(),worldMatrix=new THREE.Matrix4();let retired=false,proxy=null;
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);if(!mesh.geometry?.boundingBox)mesh.geometry?.computeBoundingBox();
    const box=mesh.geometry?.boundingBox;
    const standard=mesh.isInstancedMesh&&mesh.raycast===THREE.InstancedMesh.prototype.raycast&&!mesh.morphTexture
      &&Object.values(mesh.geometry.morphAttributes||{}).every(rows=>!rows.length);
    if(standard){
      for(let instanceId=0;instanceId<mesh.count;instanceId++){
        mesh.getMatrixAt(instanceId,matrix);worldMatrix.multiplyMatrices(mesh.matrixWorld,matrix);
        records.push({mesh,instanceId,box:box.clone().applyMatrix4(worldMatrix)});
      }
    }else{
      if(mesh.isInstancedMesh&&!mesh.boundingBox)mesh.computeBoundingBox();
      records.push({mesh,instanceId:null,box:(mesh.isInstancedMesh?mesh.boundingBox:box)?.clone().applyMatrix4(mesh.matrixWorld)||new THREE.Box3(new THREE.Vector3(-Infinity,-Infinity,-Infinity),new THREE.Vector3(Infinity,Infinity,Infinity))});
    }
  }
  const index=createSpatialBoundsIndex({THREE,records,visible:record=>visible(record.mesh),...options});
  return {
    query:ray=>index.query(ray),
    intersect(raycaster,candidates){
      if(retired)throw new Error('Instance pick index has retired.');
      const hits=[],instanceHits=[],objects=new Set();let exactInstanceTests=0,legacyInstanceUpperBound=0;
      for(const record of candidates.records){
        const {mesh,instanceId}=record;if(!visible(mesh)||!raycaster.layers.test(mesh.layers))continue;objects.add(mesh);
        if(instanceId===null){
          mesh.raycast(raycaster,hits);if(mesh.isInstancedMesh)legacyInstanceUpperBound+=mesh.count;continue;
        }
        if(instanceId>=mesh.count)continue;
        mesh.getMatrixAt(instanceId,matrix);worldMatrix.multiplyMatrices(mesh.matrixWorld,matrix);
        proxy ||= new THREE.Mesh(mesh.geometry,mesh.material);
        proxy.geometry=mesh.geometry;proxy.material=mesh.material;proxy.matrixWorld.copy(worldMatrix);instanceHits.length=0;
        proxy.raycast(raycaster,instanceHits);exactInstanceTests++;
        for(const hit of instanceHits){hit.object=mesh;hit.instanceId=instanceId;hits.push(hit);}
      }
      hits.sort((left,right)=>left.distance-right.distance);
      return {hits,metrics:{cellsVisited:candidates.cellsVisited,candidateObjects:objects.size,candidateSlots:candidates.records.filter(record=>record.instanceId!==null).length,
        exactInstanceTests:legacyInstanceUpperBound?null:exactInstanceTests,optimizedInstanceTests:exactInstanceTests,legacyInstanceUpperBound,
        residentPickRecords:records.length,fullResidentFallback:candidates.fallback,backend:'exact-cpu-instance'}};
    },
    dispose(){if(retired)return;retired=true;index.dispose();records.length=0;if(proxy){proxy.geometry=null;proxy.material=null;proxy=null;}}
  };
};
