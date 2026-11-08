const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** Largest unoccluded rectangle, in canvas-relative CSS pixels. */
export const usableViewport = ({ width, height, obstacles = [], padding = 24 }) => {
  let candidates=[{left:0,top:0,right:Math.max(1,width),bottom:Math.max(1,height)}];
  for(const obstacle of obstacles.slice(0,16)){
    const next=[];
    for(const region of candidates){
      const left=Math.max(region.left,obstacle.left),right=Math.min(region.right,obstacle.right);
      const top=Math.max(region.top,obstacle.top),bottom=Math.min(region.bottom,obstacle.bottom);
      if(right<=left||bottom<=top){next.push(region);continue;}
      next.push({left:region.left,right:left,top:region.top,bottom:region.bottom},
        {left:right,right:region.right,top:region.top,bottom:region.bottom},
        {left:region.left,right:region.right,top:region.top,bottom:top},
        {left:region.left,right:region.right,top:bottom,bottom:region.bottom});
    }
    candidates=next.filter(row=>row.right>row.left&&row.bottom>row.top)
      .sort((a,b)=>(b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top)).slice(0,64);
  }
  const region=candidates[0]||{left:0,top:0,right:Math.max(1,width),bottom:Math.max(1,height)};
  const inset=Math.min(padding,(region.right-region.left)/4,(region.bottom-region.top)/4);
  return {left:region.left+inset,right:region.right-inset,top:region.top+inset,bottom:region.bottom-inset};
};

export const fitOrthographicBounds = ({ THREE, camera, bounds, viewport, usable,
  requestedMin = 0.05, requestedMax = 80 }) => {
  const inverse=camera.quaternion.clone().invert(),corners=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    corners.push(new THREE.Vector3(finite(x),finite(y),finite(z)).applyQuaternion(inverse));
  }
  const oriented=new THREE.Box3().setFromPoints(corners);
  const spanX=Math.max(0.001,oriented.max.x-oriented.min.x),spanY=Math.max(0.001,oriented.max.y-oriented.min.y);
  const width=Math.max(1,viewport.width),height=Math.max(1,viewport.height);
  const available=usable||usableViewport({width,height});
  const worldWidth=Math.max(0.001,camera.right-camera.left),worldHeight=Math.max(0.001,camera.top-camera.bottom);
  const zoom=Math.min(worldWidth*(available.right-available.left)/width/spanX,worldHeight*(available.bottom-available.top)/height/spanY);
  if(!Number.isFinite(zoom)||zoom<=0)throw new Error('Represented bounds cannot produce a finite camera fit.');
  const center=new THREE.Vector3().addVectors(oriented.min,oriented.max).multiplyScalar(0.5);
  const ndcX=(available.left+available.right)/width-1,ndcY=1-(available.top+available.bottom)/height;
  center.x-=ndcX*worldWidth/(2*zoom);center.y-=ndcY*worldHeight/(2*zoom);
  const depth=Math.max(1,oriented.max.z-oriented.min.z),margin=Math.max(10,depth*0.25);
  center.z=oriented.max.z+margin;
  camera.position.copy(center.applyQuaternion(camera.quaternion));
  camera.zoom=zoom;
  camera.near=Math.max(0.001,margin/1000);camera.far=margin+depth+Math.max(10,depth*0.25);
  camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  return { zoom, min:Math.min(Math.max(Number.EPSILON,finite(requestedMin,zoom/4)),zoom/4),
    max:Math.max(finite(requestedMax,80),zoom*16), usable:available,
    near:camera.near,far:camera.far,scope:'currently represented visible world geometry' };
};

export const visibleWorldBounds = ({ THREE, roots }) => {
  const bounds=new THREE.Box3(),local=new THREE.Box3();
  const visit=object=>{
    if(!object||object.visible===false)return;
    object.updateWorldMatrix?.(true,false);
    if(object.geometry){
      if(object.isInstancedMesh){if(!object.boundingBox)object.computeBoundingBox();local.copy(object.boundingBox);}
      else{if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();local.copy(object.geometry.boundingBox);}
      bounds.union(local.applyMatrix4(object.matrixWorld));
    }
    for(const child of object.children||[])visit(child);
  };
  for(const root of roots)visit(root);
  if(bounds.isEmpty())bounds.set(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,1,1));
  return bounds;
};
