import { captureSceneResource, getPendingSceneResourceOwners, preserveSceneCleanupFailures } from '../scene-retirement.js';
import { rendererCapabilities } from './boundary.js';
import { captureSceneFailure } from '../scene-failure-inspection.js';
import { retainSceneDisposerFailure } from './scene-disposer-guard.js';

const fallbacks=new WeakMap();
export const invalidateRendererFallback = state => { fallbacks.delete(state); };

export const describeRendererFailure = error => {
  const captured=captureSceneFailure(error);if(captured.hasMessage)return captured.message;
  return 'Renderer operation failed.';
};

/** Always restore the source capability/status even if exact scene cleanup fails.
 * Failed owners remain with their existing scoped reconciliation capabilities. */
export const enterSourceRendererFallback = async ({state,summary,retry,error,cleanup=null}) => {
  const cleanupErrors=[];
  const fallback={source:state.sourceIndex,remote:state.remoteSource,scene:state.scene,renderer:state.renderer};
  let dispose,captureFailed=false;
  try{dispose=state.disposeScene;}catch(cleanup){captureFailed=true;cleanupErrors.push(cleanup);}
  retainSceneDisposerFailure(dispose,error);
  fallbacks.set(state,fallback);
  state.rendererFailure=preserveSceneCleanupFailures(error,[],{hasPrimary:true,forceAggregate:true});
  state.rendererCapabilities=rendererCapabilities({sourceOnly:true});
  summary.textContent=`3D unavailable: ${describeRendererFailure(error)}. Source hierarchy and inspection remain usable.`;
  summary.append(retry);
  const current=()=>{
    try{return fallbacks.get(state)===fallback&&state.sourceIndex===fallback.source&&state.remoteSource===fallback.remote
      &&state.scene===fallback.scene&&state.renderer===fallback.renderer&&(captureFailed||state.disposeScene===dispose);}catch{return false;}
  };
  const perform=typeof cleanup==='function'?cleanup:typeof dispose==='function'?()=>dispose.call(state):null;
  if(perform){
    const owner=captureSceneResource({dispose:perform},'source fallback original scene');
    owner.retainFailure(error);
    try{await owner.retireAsync();}catch(cleanup){cleanupErrors.push(cleanup);}
  }
  const failure=preserveSceneCleanupFailures(error,cleanupErrors,{hasPrimary:true,forceAggregate:true});
  // A retry/source replacement may publish while this exact disposer drains.
  // Its result keeps the old failure; it cannot adopt the new scene's state.
  if(current()){
    state.rendererFailure=failure;
    if(cleanupErrors.length){
      state.sceneRetirementFailure=failure;state.sceneRetirementError=describeRendererFailure(failure);
      state.sceneRetirementOwners=getPendingSceneResourceOwners();
    }
  }
  return failure;
};
