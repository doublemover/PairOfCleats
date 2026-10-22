import assert from 'node:assert/strict';
import * as THREE from 'three';
import { state } from '../../src/map/isometric/client/state.js';
import { buildSnapshotOverview } from '../../src/map/isometric/client/rendering/snapshot-overview.js';
import { clearGroup } from '../../src/map/isometric/client/scene-utils.js';
import { visualDefaults } from '../../src/map/isometric/client/defaults.js';

Object.assign(state,{THREE,residentFiles:null,fileGroup:new THREE.Group(),labelGroup:new THREE.Group(),fileMeshes:[],shapeGeometryCache:new Map(),
  camera:new THREE.OrthographicCamera(),scaleFactor:1,visuals:{...visualDefaults},labelMaterials:[]});
const manifest={snapshot:'source:a',overview:[{key:'input',label:'input',files:1500,members:20000},{key:'output',label:'output',files:500,members:3000}]};
buildSnapshotOverview(manifest,{createLabel:()=>new THREE.Object3D()});
assert.equal(state.fileMeshes.length,2);assert.equal(state.fileMeshes.reduce((sum,mesh)=>sum+mesh.userData.availableFiles,0),2000);
assert.equal(state.fileMeshes.every(mesh=>mesh.userData.type==='snapshotAggregate'&&mesh.userData.snapshot==='source:a'),true);
assert.equal(state.drawCounts.files,0,'aggregate proxies cannot masquerade as drawn source files');assert.equal(state.drawCounts.members,0);assert.equal(state.drawCounts.aggregateProxies,2);
assert.ok(state.labelGroup.children.every(label=>label.userData.stackLabelLevel==='pipeline'));
clearGroup(state.fileGroup);clearGroup(state.labelGroup);for(const geometry of state.shapeGeometryCache.values())geometry.dispose();
console.log('Rendered aggregate geometry retains whole-snapshot counts and distinct non-entity identity.');
