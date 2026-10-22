import { createViewerSettingsSession, emptyViewerPreferences, validateViewerPreferences } from './effective-settings.js';

export const loadViewerSettingsSession = async (config, { fetchImpl = fetch, onStatus = () => {} } = {}) => {
  const authority=config.preferences;
  let document=emptyViewerPreferences(authority?.repoId||'session-only'),persist=null,failure=null;
  if(authority?.repoId&&authority.endpoint&&authority.token){
    const headers={'X-Map-Session':authority.token};
    try{
      const response=await fetchImpl(authority.endpoint,{headers,signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error(`Preferences HTTP ${response.status}`);
      const text=await response.text();if(text.length>65536)throw new Error('Preferences response is too large.');
      document=validateViewerPreferences(JSON.parse(text),authority.repoId);
      persist=async value=>{
        const result=await fetchImpl(authority.endpoint,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},
          body:JSON.stringify(value),signal:AbortSignal.timeout(5000)});
        const body=await result.json();
        if(!result.ok)throw new Error(body.error||`Preferences HTTP ${result.status}`);
        return body;
      };
    }catch(error){failure=error.message;}
  }
  const session=createViewerSettingsSession({repoId:authority?.repoId||'session-only',report:config,document,persist,onStatus});
  session.availabilityError=failure;
  if(failure)onStatus(`save-unavailable: ${failure}`);
  return session;
};
