import { state } from '../state.js';
import { createGraphWorkerClient } from './worker-client.js';

/** Data lifetime is independent of renderer retry, context loss and scene rebuild. */
export const initSnapshotData = config => {
  state.disposeSnapshotData?.();
  if(!config)return null;
  let client,disposed=false;
  const pagehide=()=>dispose();
  const dispose=()=>{
    if(disposed)return;disposed=true;window.removeEventListener('pagehide',pagehide);client?.dispose();
    if(state.graphWorkerClient===client){state.graphWorkerClient=null;state.graphWorkerReady=false;state.disposeSnapshotData=null;}
  };
  try{
    client=createGraphWorkerClient({...config,onProgress:message=>{
      if(disposed)return;state.graphWorkerProgress=message;
      if(message.event==='overview')state.snapshotManifest=message.manifest;
      if(message.event==='ready'){state.graphWorkerReady=true;state.remoteSource?.releaseFallbackPages();state.onSourceQueryReady?.();}
    },onFailure:error=>{if(!disposed){state.graphWorkerReady=false;state.graphWorkerError=error.message;state.onSourceQueryFailure?.(error);}}});
    state.graphWorkerClient=client;state.graphWorkerReady=false;state.disposeSnapshotData=dispose;
    window.addEventListener('pagehide',pagehide,{once:true});return client;
  }catch(error){state.graphWorkerError=error.message;state.graphWorkerReady=false;dispose();return null;}
};
