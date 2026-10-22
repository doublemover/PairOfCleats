/** Real Three.js CPU geometry + DOM-emulated controls. No WebGL/FPS assertion. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { Window } from 'happy-dom';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { buildStackModel,resolveStackTier } from '../../src/map/isometric/client/stack-model.js';
import { state } from '../../src/map/isometric/client/state.js';
import { initMapData } from '../../src/map/isometric/client/map-data.js';
import { computeLayout } from '../../src/map/isometric/client/layout.js';
import { buildMeshes } from '../../src/map/isometric/client/meshes.js';
import { buildEdges } from '../../src/map/isometric/client/edges.js';
import { initStackNavigation,navigateStack } from '../../src/map/isometric/client/stack-navigation.js';
import { updateStackVisibility } from '../../src/map/isometric/client/stack-scene.js';
import { rebuildScene } from '../../src/map/isometric/client/rebuild.js';
import { clearGroup } from '../../src/map/isometric/client/scene-utils.js';
import { layoutDefaults,visualDefaults,performanceDefaults } from '../../src/map/isometric/client/defaults.js';
import { resolveMapViewerAsset } from '../../tools/analysis/map-viewer-assets.js';
const map={nodes:[{path:'input/read.ts',id:'input/read.ts',category:'source',members:[{id:0,name:'receive',kind:'function',range:{startLine:1,endLine:4}},{id:1,name:'Payload',kind:'class'}]},{path:'output/write.ts',id:'output/write.ts',category:'source',members:[{id:2,name:'emit',kind:'function'}]}],edges:[{type:'call',from:{file:'input/read.ts',member:0},to:{file:'output/write.ts',member:2},certainty:'inferred'},{type:'usage',from:{file:'input/read.ts',member:1},to:{file:'output/write.ts',member:2}}],summary:{}};
const first=buildStackModel(map.nodes,map.edges),again=buildStackModel([...map.nodes].reverse(),map.edges);
assert.deepEqual(first.files.map(row=>[row.key,row.x,row.z]),again.files.map(row=>[row.key,row.x,row.z]));
assert.equal(first.levels.segments.length,2);assert.equal(first.levels.pipeline.length,2);assert.equal(first.files[0].members[0].id,'0');
assert.ok(first.files[0].members[1].y>first.files[0].members[0].y);assert.equal(first.files[0].members[0].shape,'circle');
assert.strictEqual(first.levels.pipeline[0].evidence[0],map.edges[0]);
const bad=buildStackModel(map.nodes,[{type:'call',from:{member:0,file:'wrong'},to:{member:2}}]);assert.equal(bad.coverage.unresolvedEdges,1);assert.equal(bad.levels.segments.length,0);
assert.equal(resolveStackTier({projectedFilePixels:10}),'pipeline');assert.equal(resolveStackTier({projectedFilePixels:50}),'stacks');assert.equal(resolveStackTier({projectedFilePixels:120}),'segments');assert.equal(resolveStackTier({projectedFilePixels:80,previous:'segments'}),'segments');
const many=buildStackModel(Array.from({length:1000},(_,index)=>({path:`g${index%10}/${index}.js`,members:Array.from({length:30},(_,j)=>({id:`${index}:${j}`,name:`m${j}`}))})),[],{maxFiles:60,maxMembers:300});
assert.equal(many.files.length,60);assert.equal(many.files.reduce((sum,file)=>sum+file.members.length,0),300);assert.equal(many.coverage.omittedFiles,940);
const window=new Window({settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});globalThis.window=window;globalThis.document=window.document;
document.write(renderIsometricHtml({mapModel:map,threeUrl:'/three/three.module.js'}).replace(/<script[\s\S]*?<\/script>/g,''));
Object.assign(state,{THREE,map,config:{},layout:{...layoutDefaults},layoutDefaults,visuals:{...visualDefaults,glass:{...visualDefaults.glass}},performance:{...performanceDefaults,drawCaps:{files:20,members:40,edges:40,labels:0}},scaleFactor:1,
  camera:new THREE.OrthographicCamera(-40,40,40,-40,0.1,5000),controls:{zoomMin:0.05,zoomMax:80},getViewport:()=>({width:1200,height:750}),dom:{app:document.getElementById('app'),selectionBody:document.getElementById('selection-body')},selected:null,hovered:null,hoveredRef:null,edgeVisibility:new Map(),drawCounts:{},stackMode:'auto'});
for(const key of ['fileGroup','memberGroup','labelGroup','edgeGroup','wireGroup'])state[key]=new THREE.Group();state.labelGroup.visible=false;
for(const key of ['fileMeshes','fileInstancedMeshes','fileInstancedInnerMeshes','memberMeshes','memberInstancedMeshes','memberClusters','chunkMeshes','fileBuckets','edgeMeshes','edgeSegments','edgeTypes','glassMaterials','wireMaterials','flowMaterials','glowMaterials','labelMaterials'])state[key]=[];
for(const key of ['fileInstanceByKey','fileColorByPath','fileAnchors','memberInstanceById','memberColorById','memberClusterByMemberId','memberAnchors','edgeTypeGroups','fileWireByKey','wireByMesh','fileMeshByKey','memberMeshById','fileBucketByKey'])state[key]=new Map();
state.highlightedMemberIds=new Set();state.highlightedFileKeys=new Set();
initMapData();computeLayout();initStackNavigation();buildMeshes();buildEdges();
assert.ok(state.stackPipeLayers.filter(layer=>layer.level!==state.stackTier).every(layer=>layer.mesh===null&&layer.owner.geometries.length===0),'inactive fine levels allocate no vertex buffers or materials');
// Selection changes may affect visibility without changing full-level vertices.
for(const tier of ['pipeline','stacks','segments']){
  state.stackMode=tier;state.stackAllConnections=true;updateStackVisibility(true);
  const layers=state.stackPipeLayers.filter(layer=>layer.level===tier);
  const geometries=layers.map(layer=>layer.mesh.geometry);
  const positions=geometries.map(geometry=>Array.from(geometry.attributes.position.array));
  let disposed=0;const note=()=>{disposed++;};geometries.forEach(geometry=>geometry.addEventListener('dispose',note));
  for(let index=0;index<20;index++){
    state.selectedInfo={type:'file',file:index%2?'input/read.ts':'output/write.ts'};updateStackVisibility(true);
    layers.forEach((layer,offset)=>{assert.strictEqual(layer.mesh.geometry,geometries[offset]);assert.deepEqual(Array.from(layer.mesh.geometry.attributes.position.array),positions[offset]);});
  }
  assert.equal(disposed,0,`${tier}: full-level selection changes retire no pipe geometry`);
  const firstLayer=layers[0];state.edgeVisibility.set(firstLayer.type,false);firstLayer.mesh.parent.visible=false;updateStackVisibility(true);
  layers.forEach((layer,index)=>assert.strictEqual(layer.mesh.geometry,geometries[index],'type hiding preserves unchanged geometry'));
  assert.ok(!state.stackVisibleRows.some(row=>row.type===firstLayer.type),'visible plumbing excludes hidden type');
  state.edgeVisibility.set(firstLayer.type,true);firstLayer.mesh.parent.visible=true;updateStackVisibility(true);
  assert.equal(disposed,0,'type hide/show retires no unchanged topology');
  geometries.forEach(geometry=>geometry.removeEventListener('dispose',note));
}
state.stackAllConnections=false;
navigateStack({type:'file',file:'input/read.ts',id:'input/read.ts'});
const edgeSummary=[...state.dom.selectionBody.querySelectorAll('.sel-section')].find(section=>section.querySelector('.sel-title')?.textContent==='Edges');
const outgoing=[...edgeSummary.querySelectorAll('.sel-row')].find(row=>row.querySelector('.sel-label')?.textContent==='Outgoing');
assert.match(outgoing.textContent,/call: 1/);assert.match(outgoing.textContent,/usage: 1/);
assert.match(state.dom.selectionBody.textContent,/→ call/,'typed summary agrees with the directed relationship actions');
assert.equal(state.drawCounts.members,3);assert.equal(state.chunkMeshes.length,0,'no invented decorative chunks');
for(const mesh of [...state.fileInstancedMeshes,...state.memberInstancedMeshes]){for(let index=0;index<mesh.count;index++){const matrix=new THREE.Matrix4();mesh.getMatrixAt(index,matrix);assert.ok(matrix.elements.every(Number.isFinite));assert.ok(matrix.determinant()>0);}}
navigateStack({type:'member',id:0,file:'input/read.ts',name:'receive'});assert.equal(state.selectedInfo.id,0);assert.match(state.dom.selectionBody.textContent,/Directed relationships/);assert.match(state.dom.selectionBody.textContent,/All source fields/);
state.stackMode='segments';updateStackVisibility(true);const active=state.stackPipeLayers.filter(row=>row.mesh?.visible);assert.ok(active.length);assert.match(document.getElementById('stack-status').textContent,/1 visible pipes/);
navigateStack({type:'member',id:2,file:'output/write.ts',name:'emit'});document.getElementById('stack-back').click();assert.equal(state.selectedInfo.id,0);document.getElementById('stack-forward').click();assert.equal(state.selectedInfo.id,2);
const search=document.getElementById('stack-search');search.value='receive';search.dispatchEvent(new window.Event('input'));assert.match(document.getElementById('stack-tree').textContent,/receive/);assert.doesNotMatch(document.getElementById('stack-tree').textContent,/output\/write/);
for(let index=0;index<20;index++){state.stackMode=['pipeline','stacks','segments'][index%3];updateStackVisibility(true);}assert.equal(state.stackPipeLayers.length,6);assert.ok(state.camera.position.toArray().every(Number.isFinite));
document.getElementById('stack-plumbing').click();assert.match(state.dom.selectionBody.textContent,/dependency plumbing/);assert.match(state.dom.selectionBody.textContent,/source relations/);
const oldGeometry=state.stackPipeLayers[0].mesh.geometry;let disposed=false;oldGeometry.addEventListener('dispose',()=>{disposed=true;});
const retired=new Map();for(const owner of state.stackPipeOwners)for(const geometry of owner.geometries){retired.set(geometry,0);geometry.addEventListener('dispose',()=>retired.set(geometry,retired.get(geometry)+1));}
clearGroup(state.edgeGroup);assert.equal(disposed,false,'generic group teardown defers retained geometry to its owner');
for(const owner of state.stackPipeOwners)owner.dispose();assert.equal(disposed,true);assert.equal(state.edgeGroup.children.length,0);
assert.ok([...retired.values()].every(count=>count===1),'full and selected-neighborhood geometries retire exactly once');
Object.assign(state,{scene:new THREE.Scene(),visualDefaults,controlDefaults:{zoomMin:0.05,zoomMax:80},fogBounds:{maxSpan:80},lineResolution:{width:1200,height:750},cameraBase:40,groundPlane:new THREE.Plane(new THREE.Vector3(0,1,0),0),lockIsometric:()=>{},cameraInitialized:true,flowLights:[]});
for(let index=0;index<3;index++)rebuildScene();
assert.equal(state.fileInstancedMeshes.length,2);assert.equal(state.memberInstancedMeshes.length,3);assert.equal(state.stackPipeLayers.length,6);assert.equal(state.drawCounts.members,3);assert.equal(state.selectedInfo.id,2);
// Verify every relative import resolves to a served module, including shared helpers outside /isomap.
const root=path.resolve('src/map/isometric/client'),server=await fs.readFile('tools/analysis/map-iso-serve.js','utf8');
const visit=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await visit(file);else if(entry.name.endsWith('.js')){const source=await fs.readFile(file,'utf8');for(const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)){if(!match[1].startsWith('.'))continue;const imported=path.resolve(path.dirname(file),match[1]);await fs.access(imported);const url=new URL(match[1],'https://fixture/isomap/'+path.relative(root,file)).pathname;if(!url.startsWith('/isomap/'))assert.equal(resolveMapViewerAsset(process.cwd(),url),imported,url);}}}};
await visit(root);assert.doesNotMatch(server,/selfsigned/);assert.match(server,/runMapPreview/);assert.match(renderIsometricHtml({mapModel:map,threeUrl:'/three/three.module.js'}),/type="importmap"/);
await window.happyDOM.close();console.log('Real Three.js stack geometry, exact multiscale relations, bounded model, navigation/history/search, semantic zoom and resource disposal passed without WebGL.');
