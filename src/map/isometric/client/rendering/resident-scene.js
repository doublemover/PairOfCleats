import { state } from '../state.js';
import { buildStackModel } from '../stack-model.js';
import { buildStackMeshes, buildStackPipes, updateStackVisibility } from '../stack-scene.js';
import { clearGroup } from '../scene-utils.js';
import { setSelection, setSemanticSelection } from '../selection.js';
import { updateFileOpacity, updateMemberOpacity } from '../materials.js';
import { applyViewerAppearance } from '../appearance.js';
import { retirePicking } from './picking-owner.js';

const groups=['fileGroup','memberGroup','labelGroup','edgeGroup','wireGroup'];
const arrays=['fileMeshes','fileInstancedMeshes','fileInstancedInnerMeshes','memberMeshes','memberInstancedMeshes','memberInnerInstancedMeshes','chunkMeshes','memberClusters','fileBuckets','pickTargets','edgeMeshes','edgeSegments','edgeCullingTargets','edgeTypes','stackPipeLayers','stackPipeOwners','stackVisibleRows','labelMaterials','stackMaterials'];
const maps=['memberInstanceById','memberClusterByMemberId','fileInstanceByKey','fileBucketByKey','fileAnchors','memberAnchors','fileMeshByKey','fileWireByKey','memberMeshById','fileColorByPath','memberColorById','wireByMesh','edgeTypeGroups'];
const metadata=['stackModel','allFiles','groups','bounds','layoutMetrics','drawCounts','stackVisibilityKey','stackVisibilityModel','stackTier','viewerCoverage','residentFiles','residentEdges','residencyCoverage','preparingScene','stackPacketOwner','pipeBufferMetrics'];
const keys=[...groups,...arrays,...maps,...metadata,'highlightedMemberIds','highlightedFileKeys'];
const capture=()=>Object.fromEntries(keys.map(key=>[key,state[key]]));

export const retireResidentScene = candidate => {
  if(candidate.retired||candidate.published)return;
  candidate.retired=true;
  for(const key of groups)clearGroup(candidate.values[key]);
  for(const owner of candidate.values.stackPipeOwners||[])owner.dispose();
  candidate.values.stackPacketOwner?.dispose();
};

/** Build into detached groups; no await while the singleton builder is borrowed. */
export const prepareResidentScene = async (request, operation) => {
  await new Promise(resolve=>setTimeout(resolve,0));
  operation.signal.throwIfAborted();
  if(state.layoutStyle!=='stacks')throw new Error('Progressive resident reveal currently requires semantic stacks. Source inspection remains available.');
  const model=request.model||buildStackModel(request.nodes,request.edges,{scale:state.scaleFactor||1,groupDepth:state.layout.groupDepth||1,
    maxFiles:request.limits.files,maxMembers:request.limits.members,maxEdges:request.limits.edges,fileByMember:state.sourceIndex.fileByMember});
  operation.signal.throwIfAborted();
  const previous=capture(),stage={retired:false,published:false,values:{}},preparedGroups={};
  try{
    for(const key of groups){const group=new state.THREE.Group();preparedGroups[key]=group;group.visible=previous[key]?.visible!==false;group.userData={...previous[key]?.userData};group.renderOrder=previous[key]?.renderOrder||0;}
  }catch(error){for(const group of Object.values(preparedGroups))clearGroup(group);throw error;}
  try{
    Object.assign(state,preparedGroups);state.stackPacketOwner=null;
    for(const key of arrays)state[key]=[];
    for(const key of maps)state[key]=new Map();
    state.highlightedMemberIds=new Set();state.highlightedFileKeys=new Set();
    Object.assign(state,{preparingScene:true,stackModel:model,allFiles:model.files,groups:model.groups,bounds:model.bounds,
      residentFiles:request.nodes,residentEdges:request.edges,residencyCoverage:request.coverage,
      layoutMetrics:{...previous.layoutMetrics},drawCounts:{files:0,members:0,edges:0,labels:0},stackVisibilityKey:null,stackVisibilityModel:null});
    buildStackMeshes();buildStackPipes();updateFileOpacity();updateMemberOpacity();
    stage.values=capture();stage.values.preparingScene=false;
    return stage;
  }catch(error){stage.values=capture();retireResidentScene(stage);throw error;}
  finally{Object.assign(state,previous);}
};

export const commitResidentScene = (candidate,request) => {
  const previous=capture(),added=[];
  try{
    for(const key of groups){state.scene.add(candidate.values[key]);added.push(candidate.values[key]);}
    Object.assign(state,candidate.values);
  }catch(error){for(const group of added)state.scene.remove(group);Object.assign(state,previous);throw error;}
  candidate.published=true;
  state.remoteSource?.registerPlan(request);
  retirePicking();
  state.geometryRevision=(state.geometryRevision||0)+1;
  for(const key of groups){state.scene.remove(previous[key]);try{clearGroup(previous[key]);}catch(error){state.sceneRetirementError=error.message;}}
  try{previous.stackPacketOwner?.dispose();}catch(error){state.sceneRetirementError=error.message;}
  for(const owner of previous.stackPipeOwners||[])try{owner.dispose();}catch(error){state.sceneRetirementError=error.message;}
  state.hovered=null;state.hoveredRef=null;state.selected=null;
  try{
    const selected=request.selected,reference=selected.type==='member'?state.memberInstanceById.get(selected.id):state.fileInstanceByKey.get(selected.file);
    if(reference)setSelection({object:reference.mesh,instanceId:reference.instanceId});else setSemanticSelection(selected);
    if(state.appearance)applyViewerAppearance(state,state.appearance);
    updateStackVisibility(true);state.renderEdgeMenu?.();state.invalidateHover?.();state.invalidateRender?.();
  }catch(error){state.onRendererStatus?.(`Resident evidence committed; presentation refresh failed: ${error.message}`);}
};
