const axes=['x','y','z'];
const key=cell=>JSON.stringify(cell);

/** Shared resident broad phase; overflow returns exact-test candidates. */
export const createSpatialBoundsIndex = ({THREE,records,visible=()=>true,maxCellsPerObject=512,maxVisitedCells=8192}) => {
  records=[...records];const world=new THREE.Box3(),grid=new Map(),oversized=[],order=new Map(records.map((record,index)=>[record,index]));let disposed=false;
  const ordered=found=>[...found].sort((left,right)=>order.get(left)-order.get(right));
  const finite=box=>axes.every(axis=>Number.isFinite(box.min[axis])&&Number.isFinite(box.max[axis]));
  for(const record of records)if(finite(record.box)&&!record.box.isEmpty())world.union(record.box);
  const span=world.isEmpty()?new THREE.Vector3(1,1,1):world.getSize(new THREE.Vector3());
  const cellSize=Math.max(0.001,Math.max(span.x,span.y,span.z)/Math.max(1,Math.ceil(Math.cbrt(records.length))));
  const dimensions=axes.map(axis=>Math.max(1,Math.ceil(span[axis]/cellSize)+1));
  const cellFor=point=>axes.map((axis,index)=>Math.max(0,Math.min(dimensions[index]-1,Math.floor((point[axis]-world.min[axis])/cellSize))));
  for(const record of records){
    if(!finite(record.box)){oversized.push(record);continue;}if(record.box.isEmpty())continue;
    const min=cellFor(record.box.min),max=cellFor(record.box.max),count=max.reduce((total,value,index)=>total*(value-min[index]+1),1);
    if(count>maxCellsPerObject){oversized.push(record);continue;}
    for(let x=min[0];x<=max[0];x++)for(let y=min[1];y<=max[1];y++)for(let z=min[2];z<=max[2];z++){
      const id=key([x,y,z]);if(!grid.has(id))grid.set(id,[]);grid.get(id).push(record);
    }
  }
  return {
    query(ray){
      if(disposed)throw new Error('Spatial pick index has retired.');
      const found=new Set(),point=new THREE.Vector3();let cellsVisited=0,begin=0,end=Infinity;
      const accept=record=>{if(visible(record)&&(!finite(record.box)||ray.intersectsBox(record.box)))found.add(record);};
      for(const record of oversized)accept(record);
      if(world.isEmpty())return {records:ordered(found),cellsVisited,fallback:false};
      for(const axis of axes){
        const direction=ray.direction[axis],origin=ray.origin[axis];
        if(Math.abs(direction)<1e-12){if(origin<world.min[axis]||origin>world.max[axis])return {records:ordered(found),cellsVisited,fallback:false};continue;}
        let a=(world.min[axis]-origin)/direction,b=(world.max[axis]-origin)/direction;if(a>b)[a,b]=[b,a];begin=Math.max(begin,a);end=Math.min(end,b);
      }
      if(end>=begin&&end>=0){
        ray.at(begin,point);const cell=cellFor(point),step=axes.map(axis=>ray.direction[axis]>0?1:ray.direction[axis]<0?-1:0);
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
      if(fallback)for(const record of records)if(visible(record))found.add(record);
      return {records:ordered(found),cellsVisited,fallback};
    },
    dispose(){disposed=true;grid.clear();records.length=0;oversized.length=0;order.clear();}
  };
};
