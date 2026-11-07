import { state } from '../state.js';
import { buildStackModel } from '../stack-model.js';
import { buildStackMeshes, buildStackPipes, updateStackVisibility } from '../stack-scene.js';
import { clearGroup } from '../scene-utils.js';
import { setSelection, setSemanticSelection } from '../selection.js';
import { updateFileOpacity, updateMemberOpacity } from '../materials.js';
import { applyViewerAppearance } from '../appearance.js';
import { retirePicking } from './picking-owner.js';
import { captureSceneResource, getPendingSceneResourceOwners, preserveSceneCleanupFailures } from '../scene-retirement.js';

const groups=['fileGroup','memberGroup','labelGroup','edgeGroup','wireGroup'];
const arrays=['fileMeshes','fileInstancedMeshes','fileInstancedInnerMeshes','memberMeshes','memberInstancedMeshes','memberInnerInstancedMeshes','chunkMeshes','memberClusters','fileBuckets','pickTargets','edgeMeshes','edgeSegments','edgeCullingTargets','edgeTypes','stackPipeLayers','stackPipeOwners','stackVisibleRows','labelMaterials','stackMaterials'];
const maps=['memberInstanceById','memberClusterByMemberId','fileInstanceByKey','fileBucketByKey','fileAnchors','memberAnchors','fileMeshByKey','fileWireByKey','memberMeshById','fileColorByPath','memberColorById','wireByMesh','edgeTypeGroups'];
const metadata=['stackModel','allFiles','groups','bounds','layoutMetrics','drawCounts','stackVisibilityKey','stackVisibilityModel','stackTier','viewerCoverage','residentFiles','residentEdges','residencyCoverage','preparingScene','stackPacketOwner','pipeBufferMetrics'];
const keys=[...groups,...arrays,...maps,...metadata,'highlightedMemberIds','highlightedFileKeys'];
const capture=()=>Object.fromEntries(keys.map(key=>[key,state[key]]));

export const retireResidentScene = candidate => {
  if(candidate.published)return;
  if(candidate.retired){if(candidate.retirementError)throw candidate.retirementError;return;}
  candidate.retired=true;
  const errors=[];
  for(const key of groups)try{clearGroup(candidate.values[key]);}catch(error){errors.push(error);}
  for(const owner of new Set([...(candidate.values.stackPipeOwners||[]),candidate.values.stackPacketOwner].filter(Boolean))){
    try{captureSceneResource(owner,'resident scene buffer owner').retire();}catch(error){errors.push(error);}
  }
  candidate.retirementError=preserveSceneCleanupFailures(null,errors);
  if(candidate.retirementError)throw candidate.retirementError;
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
  }catch(error){const errors=[];for(const group of Object.values(preparedGroups))try{clearGroup(group);}catch(cleanup){errors.push(cleanup);}throw preserveSceneCleanupFailures(error,errors,{hasPrimary:true});}
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
  }catch(error){stage.values=capture();try{retireResidentScene(stage);}catch(cleanup){throw preserveSceneCleanupFailures(error,[cleanup],{hasPrimary:true});}throw preserveSceneCleanupFailures(error,[],{hasPrimary:true});}
  finally{Object.assign(state,previous);}
};

export const commitResidentScene = (candidate,request) => {
  const previous=capture(),added=[];
  try{
    for(const key of groups){state.scene.add(candidate.values[key]);added.push(candidate.values[key]);}
    Object.assign(state,candidate.values);
  }catch(error){const cleanupErrors=[];for(const group of added)try{state.scene.remove(group);}catch(cleanup){cleanupErrors.push(cleanup);}Object.assign(state,previous);throw preserveSceneCleanupFailures(error,cleanupErrors,{hasPrimary:true});}
  candidate.published=true;
  const postPublishErrors=[];
  try{state.remoteSource?.registerPlan(request);}catch(error){postPublishErrors.push(error);}
  try{retirePicking();}catch(error){postPublishErrors.push(error);}
  state.geometryRevision=(state.geometryRevision||0)+1;
  const retirementErrors=[];
  for(const key of groups){try{state.scene.remove(previous[key]);}catch(error){retirementErrors.push(error);}try{clearGroup(previous[key]);}catch(error){retirementErrors.push(error);}}
  for(const owner of new Set([...(previous.stackPipeOwners||[]),previous.stackPacketOwner].filter(Boolean))){
    try{captureSceneResource(owner,'previous resident scene buffer owner').retire();}catch(error){retirementErrors.push(error);}
  }
  if(retirementErrors.length){const failure=preserveSceneCleanupFailures(null,retirementErrors);state.sceneRetirementError=failure.message;
    state.sceneRetirementFailure=failure;state.sceneRetirementOwners=getPendingSceneResourceOwners();}
  state.hovered=null;state.hoveredRef=null;state.selected=null;
  try{
    const selected=request.selected,reference=selected.type==='member'?state.memberInstanceById.get(selected.id):state.fileInstanceByKey.get(selected.file);
    if(reference)setSelection({object:reference.mesh,instanceId:reference.instanceId});else setSemanticSelection(selected);
    if(state.appearance)applyViewerAppearance(state,state.appearance);
    updateStackVisibility(true);state.renderEdgeMenu?.();state.invalidateHover?.();state.invalidateRender?.();
  }catch(error){postPublishErrors.push(error);}
  if(postPublishErrors.length||retirementErrors.length){
    throw preserveSceneCleanupFailures(postPublishErrors[0],postPublishErrors.length?[...postPublishErrors.slice(1),...retirementErrors]:retirementErrors,
      {hasPrimary:postPublishErrors.length>0,forceAggregate:true});
  }
};
