/** Authored CPU contract; no WebGL, GPU-ID or pointer-latency acceptance. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSpatialPickIndex, createPickFence } from '../../src/map/isometric/client/rendering/spatial-pick.js';
import { markInstanceRange } from '../../src/map/isometric/client/rendering/attribute-ranges.js';

const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshBasicMaterial();
const root=new THREE.Group(),meshes=[];
for(let x=0;x<100;x++){
  const mesh=new THREE.InstancedMesh(geometry,material,1),matrix=new THREE.Matrix4().makeTranslation(x*10,0,0);
  mesh.setMatrixAt(0,matrix);mesh.userData.instanceInfo=[{id:`opaque:${x}:😀`}];root.add(mesh);meshes.push(mesh);
}
const index=createSpatialPickIndex({THREE,meshes}),raycaster=new THREE.Raycaster(new THREE.Vector3(990,0,10),new THREE.Vector3(0,0,-1));
const candidates=index.query(raycaster.ray);
assert.ok(candidates.meshes.length<meshes.length);assert.equal(candidates.fallback,false);
assert.equal(raycaster.intersectObjects(candidates.meshes,false)[0].object.userData.instanceInfo[0].id,'opaque:99:😀');
root.visible=false;assert.equal(index.query(raycaster.ray).meshes.length,0);
root.visible=true;assert.equal(index.query(raycaster.ray).meshes[0],meshes[99],'hide/show needs no target-list rebuild');
const bounded=createSpatialPickIndex({THREE,meshes,maxVisitedCells:1});
const fallback=bounded.query(raycaster.ray);assert.equal(fallback.fallback,true);
assert.equal(raycaster.intersectObjects(fallback.meshes,false)[0].object,meshes[99],'bounded traversal falls back to exact resident tests');
let revision={source:'generation:a',slots:1,camera:1,width:1000,height:800,dpr:1};
const fence=createPickFence(()=>({...revision}));
const first=fence.capture({x:0,y:0});revision.slots++;assert.equal(fence.accept(first,'reused slot'),null);
const second=fence.capture({x:0,y:0});fence.capture({x:1,y:1});assert.equal(fence.accept(second,'old pointer'),null);
const third=fence.capture({x:1,y:1});assert.equal(fence.accept(third,'exact current hit'),'exact current hit');
const fourth=fence.capture({x:1,y:1});fence.cancel();assert.equal(fence.accept(fourth,'after leave'),null);
const attribute=new THREE.InstancedBufferAttribute(new Float32Array(3000),3),metrics={};
markInstanceRange(attribute,700,3,metrics);assert.deepEqual(attribute.updateRanges,[{start:2100,count:3}]);
assert.equal(metrics.requestedAttributeBytes,12,'single color range counts requested bytes, not measured GPU traffic');
fence.dispose();index.dispose();bounded.dispose();assert.throws(()=>index.query(raycaster.ray),/retired/);
for(const mesh of meshes)mesh.dispose();geometry.dispose();material.dispose();
console.log('Spatial resident candidate admission, exact result revisions and changed color ranges authored.');
