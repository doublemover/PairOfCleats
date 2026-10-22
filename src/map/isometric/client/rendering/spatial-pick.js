const axes=['x','y','z'];
const visible=object=>{for(let current=object;current;current=current.parent)if(current.visible===false)return false;return true;};
const key=cell=>JSON.stringify(cell);

/** Resident-object broad phase only; candidates still use exact Three ray tests. */
export const createSpatialPickIndex = ({THREE,meshes,maxCellsPerObject=512,maxVisitedCells=8192}) => {
  const records=[],world=new THREE.Box3(),grid=new Map(),oversized=[];
  let disposed=false;
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);
    if(mesh.isInstancedMesh){if(!mesh.boundingBox)mesh.computeBoundingBox();}
    else if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    const box=(mesh.isInstancedMesh?mesh.boundingBox:mesh.geometry.boundingBox).clone().applyMatrix4(mesh.matrixWorld);
    if(box.isEmpty())continue;
    world.union(box);records.push({mesh,box});
  }
  const span=world.isEmpty()?new THREE.Vector3(1,1,1):world.getSize(new THREE.Vector3());
  const cellSize=Math.max(0.001,Math.max(span.x,span.y,span.z)/Math.max(1,Math.ceil(Math.cbrt(records.length))));
  const dimensions=axes.map(axis=>Math.max(1,Math.ceil(span[axis]/cellSize)+1));
  const cellFor=point=>axes.map((axis,index)=>Math.max(0,Math.min(dimensions[index]-1,Math.floor((point[axis]-world.min[axis])/cellSize))));
  for(const record of records){
    const min=cellFor(record.box.min),max=cellFor(record.box.max),count=max.reduce((total,value,index)=>total*(value-min[index]+1),1);
    if(count>maxCellsPerObject){oversized.push(record);continue;}
    for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++){
      const id=key([x,y,z]);if(!grid.has(id))grid.set(id,[]);grid.get(id).push(record);
    }
  }
  return {
    query(ray){
      if(disposed)throw new Error('Spatial pick index has retired.');
      const found=new Set(),point=new THREE.Vector3();
      let cellsVisited=0,begin=0,end=Infinity;
      const accept=record=>{if(visible(record.mesh)&&ray.intersectsBox(record.box))found.add(record.mesh);};
      for(const record of oversized)accept(record);
      if(world.isEmpty())return {meshes:[],cellsVisited:0,fallback:false,candidateInstances:0};
      for(const axis of axes){
        const direction=ray.direction[axis],origin=ray.origin[axis];
        if(Math.abs(direction)<1e-12){if(origin<world.min[axis]||origin>world.max[axis])return {meshes:[...found],cellsVisited:0,fallback:false,candidateInstances:0};continue;}
        let a=(world.min[axis]-origin)/direction,b=(world.max[axis]-origin)/direction;if(a>b)[a,b]=[b,a];begin=Math.max(begin,a);end=Math.min(end,b);
      }
      if(end>=begin&&end>=0){
        ray.at(begin,point);const cell=cellFor(point);
        const step=axes.map(axis=>ray.direction[axis]>0?1:ray.direction[axis]<0?-1:0);
        const delta=axes.map(axis=>Math.abs(ray.direction[axis])>1e-12?cellSize/Math.abs(ray.direction[axis]):Infinity);
        const next=axes.map((axis,index)=>step[index]===0?Infinity:(world.min[axis]+(cell[index]+(step[index]>0?1:0))*cellSize-ray.origin[axis])/ray.direction[axis]);
        while(begin<=end&&cellsVisited<maxVisitedCells&&cell.every((value,index)=>value>=0&&value<dimensions[index])){
          cellsVisited++;for(const record of grid.get(key(cell))||[])accept(record);
          const nearest=Math.min(...next);if(!Number.isFinite(nearest))break;
          for(let index=0;index<3;index++)if(next[index]<=nearest+1e-10){cell[index]+=step[index];next[index]+=delta[index];}
          begin=nearest;
        }
      }
      const fallback=cellsVisited>=maxVisitedCells;
      if(fallback)for(const record of records)if(visible(record.mesh))found.add(record.mesh);
      const candidates=[...found];
      return {meshes:candidates,cellsVisited,fallback,candidateInstances:candidates.reduce((sum,mesh)=>sum+(mesh.isInstancedMesh?mesh.count:1),0)};
    },
    dispose(){disposed=true;grid.clear();records.length=0;oversized.length=0;}
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
