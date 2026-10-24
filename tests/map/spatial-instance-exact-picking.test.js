import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInstancePickIndex } from '../../src/map/isometric/client/rendering/instance-picking.js';

const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshBasicMaterial(),mesh=new THREE.InstancedMesh(geometry,material,4096);
mesh.userData.instanceInfo=[];for(let slot=0;slot<mesh.count;slot++){
  mesh.setMatrixAt(slot,new THREE.Matrix4().makeTranslation(slot*4,0,0));mesh.userData.instanceInfo.push({id:slot===4095?0:`opaque:${slot}:😀`});
}
const root=new THREE.Group();root.position.set(3,5,7);root.add(mesh);root.updateWorldMatrix(true,true);
const raycaster=new THREE.Raycaster(new THREE.Vector3(4095*4+3,5,17),new THREE.Vector3(0,0,-1));
const index=createInstancePickIndex({THREE,meshes:[mesh]}),candidates=index.query(raycaster.ray),result=index.intersect(raycaster,candidates);
const expected=raycaster.intersectObject(mesh,false);
assert.equal(result.hits[0].instanceId,4095);assert.strictEqual(result.hits[0].object,mesh);assert.equal(mesh.userData.instanceInfo[result.hits[0].instanceId].id,0);
assert.equal(result.hits[0].distance,expected[0].distance);assert.deepEqual(result.hits[0].point.toArray(),expected[0].point.toArray());
assert.ok(result.metrics.exactInstanceTests<mesh.count,'spatial batch does not require an exact test of every slot');
assert.equal(mesh.count,4096,'exact candidate tests never rewrite live batch count or slot metadata');
root.visible=false;assert.equal(index.query(raycaster.ray).records.length,0);root.visible=true;
const bounded=createInstancePickIndex({THREE,meshes:[mesh],maxVisitedCells:1}),fallback=bounded.intersect(raycaster,bounded.query(raycaster.ray));
assert.equal(fallback.metrics.fullResidentFallback,true);assert.equal(fallback.hits[0].instanceId,4095);
raycaster.layers.disableAll();assert.equal(index.intersect(raycaster,index.query(raycaster.ray)).hits.length,0);
raycaster.layers.enable(0);
const custom=new THREE.InstancedMesh(geometry,material,1);custom.setMatrixAt(0,new THREE.Matrix4().makeTranslation(4095*4+3,5,7));
const original=custom.raycast;let customCalls=0;custom.raycast=function(...args){customCalls++;return original.apply(this,args);};
const legacy=createInstancePickIndex({THREE,meshes:[custom]}),customResult=legacy.intersect(raycaster,legacy.query(raycaster.ray));
assert.equal(customCalls,1,'custom raycasters retain their exact owner');assert.equal(customResult.metrics.exactInstanceTests,null);assert.equal(customResult.metrics.legacyInstanceUpperBound,1);
assert.strictEqual(customResult.hits[0].object,custom);legacy.dispose();custom.dispose();
index.dispose();bounded.dispose();assert.throws(()=>index.query(raycaster.ray),/retired/);mesh.dispose();geometry.dispose();material.dispose();
console.log('Per-instance spatial admission and original Three exact hit parity authored; no host/GPU/latency result.');
