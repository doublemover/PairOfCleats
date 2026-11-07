import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRepositoryStateRoot } from '../../src/shared/storage/state.js';
import { assertNoSymlinkPath, readContainedFile } from '../../src/shared/contained-file.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { withFileLock } from '../../src/shared/locks/file-lock.js';
import { emptyViewerPreferences, validateViewerPreferences, VIEWER_SETTINGS_MAX_BYTES } from '../../src/map/isometric/client/effective-settings.js';

/** repoId is supplied by getRepoId(user-selected repository), never map evidence. */
export const createMapPreferenceStore = (repoId, { descriptor = resolveRepositoryStateRoot(repoId) } = {}) => {
  if(descriptor.repoId!==repoId||descriptor.retention!=='durable')throw new Error('Viewer preference storage requires durable selected-repository authority.');
  const root=descriptor.path,target=path.join(root,'maps','viewer-preferences.json'),lockPath=`${target}.lock`;
  const contained=()=>assertNoSymlinkPath(path.parse(root).root,target,{allowMissing:true});
  const load=async()=>{
    try{
      contained();
      const bytes=await readContainedFile(root,target,{maxBytes:VIEWER_SETTINGS_MAX_BYTES});
      return validateViewerPreferences(JSON.parse(bytes.toString('utf8')),repoId);
    }catch(error){if(error.code==='ENOENT')return emptyViewerPreferences(repoId);throw error;}
  };
  return {repoId,descriptor,load,
    async save(input,{signal=null}={}){
      const requested=validateViewerPreferences(input,repoId);
      contained();await fs.mkdir(path.dirname(target),{recursive:true});contained();
      assertNoSymlinkPath(root,lockPath,{allowMissing:true});
      return withFileLock({lockPath,waitMs:1500,pollMs:25,timeoutBehavior:'throw',signal,metadata:{kind:'map-viewer-preferences',repoId}},async()=>{
        const before=await load();
        if(before.revision!==requested.revision)throw Object.assign(new Error('Preferences changed in another preview. Reload saved preferences before saving.'),{code:'ERR_VIEWER_PREFERENCE_CONFLICT'});
        const next={...requested,revision:before.revision+1};
        await atomicWriteJson(target,next,{mkdir:false,signal,beforeCommit:()=>{contained();}});
        return next;
      });
    }
  };
};
