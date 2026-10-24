import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';
import { enterSourceRendererFallback, invalidateRendererFallback } from './failure-state.js';

/** One viewer's enhancement generations. Imports have no scene authority until
 * their original request is current; cleanup uses only captured scene methods. */
export const createRendererEnhancementOwner = ({state,summary,retry,loadModules,loadEnvironment,construct,initialize,renderSummary}) => {
  let latest=null,disposed=false;
  const enhance=async()=>{
    if(disposed)return {ok:false,reason:'retired'};
    const attempt={source:state.sourceIndex,remote:state.remoteSource,dom:state.dom,scene:state.scene,renderer:state.renderer,
      initialDisposer:state.disposeScene,owners:[],acquired:false};
    latest=attempt;invalidateRendererFallback(state);
    const originalOwner=captureSceneResource(state,'enhancement original scene','disposeScene');
    const current=()=>!disposed&&latest===attempt&&state.sourceIndex===attempt.source&&state.remoteSource===attempt.remote&&state.dom===attempt.dom;
    const ownsScene=()=>state.scene===attempt.scene&&state.renderer===attempt.renderer
      &&(state.disposeScene===attempt.initialDisposer||state.disposeScene===null);
    const retire=({createdOnly=false}={})=>{
      const errors=[];
      const owners=attempt.acquired?attempt.owners:createdOnly?[]:[originalOwner];
      for(const owner of owners)try{owner.retire();}catch(error){errors.push(error);}
      const failure=preserveSceneCleanupFailures(null,errors);if(failure)throw failure;
    };
    const stale=(primary,hasPrimary=false)=>{
      const errors=[];try{retire({createdOnly:true});}catch(error){errors.push(error);}
      return {ok:false,reason:'superseded',error:preserveSceneCleanupFailures(primary,errors,{hasPrimary})};
    };
    retry.remove();summary.textContent='Source browser ready · loading local 3D assets…';
    try{
      const modules=await loadModules();
      if(!current()||!ownsScene())return {ok:false,reason:'superseded'};
      const environment=await loadEnvironment();
      if(!current()||!ownsScene())return {ok:false,reason:'superseded'};
      Object.assign(state,modules,{RGBELoader:environment});
      summary.textContent='Source browser ready · constructing 3D scene…';
      await construct({isCurrent:current,onSceneOwner:acquired=>{
        // The real scene producer calls this synchronously on installation.
        const dispose=acquired.disposeScene;
        attempt.acquired=true;attempt.scene=acquired.scene;attempt.renderer=acquired.renderer;attempt.initialDisposer=dispose;
        attempt.owners.push(captureSceneResource({dispose:()=>dispose.call(state)},'enhancement constructed scene'));
      }});
      if(!current()||!ownsScene())return stale();
      initialize();
      if(!current()||!ownsScene())return stale();
      state.rendererFailure=null;renderSummary();
      return {ok:true};
    }catch(error){
      if(!current()||!ownsScene())return stale(error,true);
      const failure=await enterSourceRendererFallback({state,summary,retry,error,cleanup:retire});
      return {ok:false,reason:'failed',error:failure};
    }
  };
  return Object.freeze({enhance,dispose(){disposed=true;latest=null;invalidateRendererFallback(state);}});
};
