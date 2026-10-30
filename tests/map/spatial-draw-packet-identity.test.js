/** Authored CPU ownership/identity parity for a candidate policy; no renderer acceptance. */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { state } from '../../src/map/isometric/client/state.js';
import { buildStackModel } from '../../src/map/isometric/client/stack-model.js';
import { createSourceIndex } from '../../src/map/isometric/client/source-index.js';
import { buildStackMeshes } from '../../src/map/isometric/client/stack-scene.js';
import { clearGroup } from '../../src/map/isometric/client/scene-utils.js';
import { planSpatialDrawPackets, createInstanceSlotTable } from '../../src/map/isometric/client/rendering/draw-packets.js';
import { createSpatialPickIndex } from '../../src/map/isometric/client/rendering/spatial-pick.js';
import { sourceEntityKey } from '../../src/map/isometric/client/data/protocol.js';
import { visualDefaults } from '../../src/map/isometric/client/defaults.js';

const policy={cellSize:64,maxInstances:32,maxPackets:2048,maxAttributeBytes:8*1024*1024};
for(const size of [20,200,500]){
  const model={nodes:Array.from({length:size},(_,i)=>({path:`g${i%2}/${i}.ts`,category:'source',members:[{id:`opaque:${i}:😀`,name:`m${i}`,kind:'function'}]})),edges:[]};
  const layout=buildStackModel(model.nodes,model.edges),plan=planSpatialDrawPackets(layout,policy);
  assert.equal(plan.instanceCount,size*2);assert.equal(plan.sourceCoverage,layout.coverage);
  assert.ok(plan.packets.every(packet=>packet.rows.length<=policy.maxInstances));
  assert.ok(plan.packets.some(packet=>new Set(packet.rows.map(row=>row.file.key)).size>1),'candidate can combine nearby compatible files');
  const keys=new Set(plan.packets.flatMap(packet=>packet.rows.map(row=>row.sourceKey)));
  for(let i=0;i<size;i++)assert.ok(keys.has(sourceEntityKey('member',`opaque:${i}:😀`)));
}
assert.throws(()=>planSpatialDrawPackets(buildStackModel([],[]),{}),/explicit finite/);
const table=createInstanceSlotTable(2),a={sourceKey:'opaque:a'},b={sourceKey:'opaque:b'},c={sourceKey:'opaque:c'};
table.commit(table.prepare([a,b]));const before=new Map(table.entries());
const delta=table.prepare([b,c]);assert.equal(delta.next.get('opaque:b').slot,before.get('opaque:b').slot);
assert.equal(delta.next.get('opaque:c').slot,before.get('opaque:a').slot);assert.equal(delta.changed.length,1,'slot reuse is a single dirty write');
table.commit(delta);assert.throws(()=>table.commit(delta),/Stale/);table.dispose();

const source={nodes:Array.from({length:20},(_,i)=>({path:`group/${i}.ts`,members:[{id:`member:${i}`,name:`m${i}`,kind:'function'}]})),edges:[]};
Object.assign(state,{THREE,sourceIndex:createSourceIndex(source),map:source,layoutStyle:'stacks',stackModel:buildStackModel(source.nodes,[]),stackPacketPolicy:policy,
  camera:new THREE.OrthographicCamera(-40,40,40,-40,.1,5000),performance:{drawCaps:{labels:0}},scaleFactor:1,shapeGeometryCache:new Map(),drawCounts:{},
  selectedInfo:null,hovered:null,hoveredRef:null,stackMaterials:[],labelMaterials:[],visuals:{...visualDefaults},visualDefaults});
for(const key of ['fileGroup','memberGroup','labelGroup','edgeGroup','wireGroup'])state[key]=new THREE.Group();state.labelGroup.visible=false;
for(const key of ['fileInstancedMeshes','memberInstancedMeshes','memberClusters'])state[key]=[];
for(const key of ['fileInstanceByKey','memberInstanceById','fileColorByPath','memberColorById','fileAnchors','memberAnchors','memberClusterByMemberId'])state[key]=new Map();
buildStackMeshes();const owner=state.stackPacketOwner;
assert.equal(state.drawCounts.files,20);assert.equal(state.drawCounts.members,20);assert.ok(owner.metrics.packetObjects<40);
const ref=state.memberInstanceById.get('member:19'),row=ref.mesh.userData.instanceInfo[ref.instanceId];assert.equal(row.id,'member:19');assert.equal(row.file,'group/19.ts');
const packet=[...owner.packets.values()].find(value=>value.mesh===ref.mesh),changed=packet.rows.map(value=>value.sourceKey===sourceEntityKey('member','member:19')?{...value,color:'#ff0080'}:value);
const matrixArray=packet.mesh.instanceMatrix.array,colorArray=packet.mesh.instanceColor.array;
const writes=owner.metrics.requestedAttributeBytes;owner.updatePacket(packet.id,changed,packet.slots.revision);
assert.strictEqual(packet.mesh.instanceMatrix.array,matrixArray);assert.strictEqual(packet.mesh.instanceColor.array,colorArray);
assert.equal(owner.metrics.requestedAttributeBytes-writes,3*4,'color-only change writes one color range without a transform upload');
assert.equal(state.memberInstanceById.get('member:19').mesh,ref.mesh);
const pickIndex=createSpatialPickIndex({THREE,meshes:[...state.fileInstancedMeshes,...state.memberInstancedMeshes]});
const raycaster=new THREE.Raycaster(new THREE.Vector3(row.x,row.y,30),new THREE.Vector3(0,0,-1));
const hits=raycaster.intersectObjects(pickIndex.query(raycaster.ray).meshes,false);
assert.ok(hits.some(hit=>hit.object.userData.instanceInfo[hit.instanceId]?.id==='member:19'));
let materialDisposals=0;for(const material of state.stackMaterials)if(material.userData.packetOwned)material.addEventListener('dispose',()=>materialDisposals++);
const expectedMaterials=state.stackMaterials.filter(material=>material.userData.packetOwned).length;
for(const key of ['fileGroup','memberGroup','labelGroup'])clearGroup(state[key]);owner.dispose();owner.dispose();
assert.equal(materialDisposals,expectedMaterials,'packet-shared materials have one explicit retiring owner');
for(const geometry of state.shapeGeometryCache.values())geometry.dispose();state.stackPacketPolicy=null;pickIndex.dispose();
console.log('Spatial candidate identities, retained slot/range updates and shared resource retirement authored.');
