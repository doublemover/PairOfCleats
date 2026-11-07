const sameRows=(left,right)=>left===right||(left?.length===right?.length&&left.every((row,index)=>row===right[index]));

/** One lazy full-level buffer and one bounded latest-neighborhood buffer. */
export const createRetainedPipeBuffer = ({THREE,rows,positionsFor,verticesPerRow=14}) => {
  const ordinals=new Map(rows.map((row,index)=>[row,index]));
  const metrics={geometryAllocations:0,geometryRetirements:0,attributeCapacityBytes:0,requestedUploadBytes:0,
    routeRowsComputed:0,unchangedSelections:0,activeVertices:0,gpuUploadBytes:null};
  const retiredGeometries=new WeakSet();
  let full=null,subset=null,active=null,disposed=false;
  const retire=buffer=>{
    if(!buffer||retiredGeometries.has(buffer.geometry))return;
    retiredGeometries.add(buffer.geometry);buffer.geometry.dispose();metrics.geometryRetirements++;
    metrics.attributeCapacityBytes-=buffer.capacity*verticesPerRow*3*4;
  };
  const capacityFor=size=>Math.min(rows.length,Math.max(1,2**Math.ceil(Math.log2(Math.max(1,size)))));
  const allocate=capacity=>{
    const geometry=new THREE.BufferGeometry(),attribute=new THREE.BufferAttribute(new Float32Array(capacity*verticesPerRow*3),3);
    geometry.setAttribute('position',attribute);geometry.userData={shared:true,retainedPipeOwner:true};
    metrics.geometryAllocations++;metrics.attributeCapacityBytes+=attribute.array.byteLength;
    return {geometry,attribute,capacity,rows:[]};
  };
  const update=(buffer,selected)=>{
    const writes=[];
    for(let slot=0;slot<selected.length;slot++)if(buffer.rows[slot]!==selected[slot]){
      const ordinal=ordinals.get(selected[slot]);if(ordinal==null)throw new Error('Pipe row is outside its committed layer.');
      const positions=positionsFor(selected[slot],ordinal);
      if(positions.length!==verticesPerRow*3||positions.some(value=>!Number.isFinite(value)))throw new Error('Pipe route has invalid bounded vertex data.');
      writes.push({slot,positions});
    }
    const ranges=[...(buffer.attribute.updateRanges||[])];
    for(const {slot,positions}of writes){
      const offset=slot*verticesPerRow*3;buffer.attribute.array.set(positions,offset);ranges.push({start:offset,count:positions.length});
      metrics.requestedUploadBytes+=positions.length*4;metrics.routeRowsComputed++;
    }
    if(writes.length){
      ranges.sort((left,right)=>left.start-right.start);const merged=[];
      for(const range of ranges){const previous=merged.at(-1);if(previous&&range.start<=previous.start+previous.count)previous.count=Math.max(previous.count,range.start+range.count-previous.start);else merged.push({...range});}
      buffer.attribute.clearUpdateRanges?.();
      for(const range of merged)buffer.attribute.addUpdateRange?.(range.start,range.count);
      buffer.attribute.needsUpdate=true;
    }
    const vertices=selected.length*verticesPerRow;
    buffer.geometry.setDrawRange(0,vertices);
    const bounds=new THREE.Box3(),point=new THREE.Vector3();
    for(let vertex=0;vertex<vertices;vertex++){point.fromBufferAttribute(buffer.attribute,vertex);bounds.expandByPoint(point);}
    buffer.geometry.boundingBox=bounds;buffer.geometry.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());
    buffer.rows=selected;metrics.activeVertices=vertices;
  };
  return {metrics,
    select(selected,{publish=()=>{}}={}){
      if(disposed)throw new Error('Retained pipe owner has retired.');
      if(selected.length>rows.length)throw new Error('Pipe selection exceeds its committed layer.');
      const entire=sameRows(selected,rows),current=entire?full:subset;
      if(current&&sameRows(current.rows,selected)){
        publish(current.geometry);active=current;metrics.unchangedSelections++;metrics.activeVertices=selected.length*verticesPerRow;return current.geometry;
      }
      let target=current,allocated=false;
      if(!target||target.capacity<selected.length){target=allocate(entire?rows.length:capacityFor(selected.length));allocated=true;}
      try{update(target,selected);publish(target.geometry);}
      catch(error){if(allocated)retire(target);throw error;}
      if(entire)full=target;else subset=target;
      active=target;if(allocated&&current)retire(current);
      return target.geometry;
    },
    get geometry(){return active?.geometry||null;},
    get geometries(){return [full?.geometry,subset?.geometry].filter(Boolean);},
    dispose(){if(disposed)return;disposed=true;retire(full);retire(subset);full=null;subset=null;active=null;ordinals.clear();}
  };
};
