import { createViewerSettingsSession, emptyViewerPreferences, validateViewerPreferences, VIEWER_SETTINGS_MAX_BYTES } from './effective-settings.js';
import { readBoundedJsonResponse } from './data/protocol.js';
import { captureSceneFailure } from './scene-failure-inspection.js';
import { preserveSceneCleanupFailures } from './scene-retirement.js';

export const loadViewerSettingsSession = async (config, { fetchImpl = fetch, onStatus = () => {} } = {}) => {
  const originalAuthority=config.preferences;
  const authority=originalAuthority?{repoId:originalAuthority.repoId,endpoint:originalAuthority.endpoint,token:originalAuthority.token}:null;
  let document=emptyViewerPreferences(authority?.repoId||'session-only'),persist=null,failure,hasFailure=false;
  if(authority?.repoId&&authority.endpoint&&authority.token){
    const headers={'X-Map-Session':authority.token};
    try{
      const signal=AbortSignal.timeout(5000);
      const response=await fetchImpl(authority.endpoint,{headers,signal});
      document=validateViewerPreferences(await readBoundedJsonResponse(response,{signal,maxBytes:VIEWER_SETTINGS_MAX_BYTES}),authority.repoId);
      persist=async value=>{
        const signal=AbortSignal.timeout(5000);
        const result=await fetchImpl(authority.endpoint,{method:'PUT',headers:{'X-Map-Session':authority.token,'Content-Type':'application/json'},
          body:JSON.stringify(value),signal});
        return readBoundedJsonResponse(result,{signal,maxBytes:VIEWER_SETTINGS_MAX_BYTES});
      };
    }catch(error){failure=error;hasFailure=true;}
  }
  const session=createViewerSettingsSession({repoId:authority?.repoId||'session-only',report:config,document,persist,onStatus});
  session.availabilityFailed=hasFailure;
  session.availabilityError=hasFailure?captureSceneFailure(failure).message:null;
  session.availabilityFailure=hasFailure?failure:null;
  if(hasFailure){
    session.resourceOwner.retainFailure(failure);
    try{onStatus(`save-unavailable: ${session.availabilityError}`);}
    catch(diagnostic){throw preserveSceneCleanupFailures(failure,[diagnostic],{hasPrimary:true,forceAggregate:true});}
  }
  return session;
};
