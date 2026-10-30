import { createSpatialBoundsIndex } from './spatial-bounds.js';
const visible=object=>{for(let current=object;current;current=current.parent)if(current.visible===false)return false;return true;};

/** Compatibility object-level view over the shared resident broad phase. */
export const createSpatialPickIndex = ({THREE,meshes,...options}) => {
  const records=[];
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);
    if(mesh.isInstancedMesh){if(!mesh.boundingBox)mesh.computeBoundingBox();}
    else if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    const box=(mesh.isInstancedMesh?mesh.boundingBox:mesh.geometry.boundingBox).clone().applyMatrix4(mesh.matrixWorld);
    if(!box.isEmpty())records.push({mesh,box});
  }
  const index=createSpatialBoundsIndex({THREE,records,visible:record=>visible(record.mesh),...options});
  return {
    query(ray){
      const result=index.query(ray),candidates=result.records.map(record=>record.mesh);
      return {meshes:candidates,cellsVisited:result.cellsVisited,fallback:result.fallback,
        candidateInstances:candidates.reduce((sum,mesh)=>sum+(mesh.isInstancedMesh?mesh.count:1),0)};
    },
    dispose(){index.dispose();records.length=0;}
  };
};

/** Async backends must fence source, slots, camera, viewport and exact pointer. */
export const createPickFence = readRevision => {
  let request=0,retired=false;
  return {
    capture(pointer){return {request:++request,revision:readRevision(),pointer:{x:pointer.x,y:pointer.y}};},
    accept(stamp,value){
      if(retired||stamp.request!==request)return null;
      const current=readRevision();
      if(Object.keys(current).some(key=>current[key]!==stamp.revision[key]))return null;
      return value;
    },
    cancel(){request++;},dispose(){retired=true;request++;}
  };
};
