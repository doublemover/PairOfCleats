import { state } from '../state.js';
import { createSpatialPickIndex, createPickFence } from './spatial-pick.js';

export const pickResidentScene = (raycaster,pointer,fallbackTargets) => {
  const source=state.sourceIndex?.snapshot,revision=state.geometryRevision||0;
  if(!state.pickIndex||state.pickIndexSource!==source||state.pickIndexRevision!==revision){
    state.pickIndex?.dispose();
    state.pickIndex=createSpatialPickIndex({THREE:state.THREE,meshes:fallbackTargets()});
    state.pickIndexSource=source;state.pickIndexRevision=revision;
  }
  if(!state.pickFence)state.pickFence=createPickFence(()=>{
    const viewport=state.getViewport();return {source:state.sourceIndex?.snapshot,geometry:state.geometryRevision||0,
      camera:state.cameraRevision||0,width:viewport.width,height:viewport.height,dpr:window.devicePixelRatio||1};
  });
  const stamp=state.pickFence.capture(pointer),candidates=state.pickIndex.query(raycaster.ray);
  const hits=raycaster.intersectObjects(candidates.meshes,false);
  state.pickMetrics={cellsVisited:candidates.cellsVisited,candidateObjects:candidates.meshes.length,
    candidateInstanceUpperBound:candidates.candidateInstances,exactInstanceTests:null,fullResidentFallback:candidates.fallback};
  return state.pickFence.accept(stamp,hits)||[];
};

export const retirePicking = () => {
  state.pickIndex?.dispose();state.pickIndex=null;state.pickFence?.dispose();state.pickFence=null;
};
