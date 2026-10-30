import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMapPreferenceStore } from '../../tools/analysis/map-viewer-preferences.js';
import { emptyViewerPreferences } from '../../src/map/isometric/client/effective-settings.js';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-viewer-preferences-'));
try{
  const descriptor={repoId:'repo-a',retention:'durable',path:path.join(root,'state','repos','repo-a')};
  const first=createMapPreferenceStore('repo-a',{descriptor}),second=createMapPreferenceStore('repo-a',{descriptor});
  assert.equal((await first.load()).revision,0);
  const initial=emptyViewerPreferences('repo-a');initial.preferences.base={appearance:{palette:'crisp'}};
  const accepted=await first.save(initial);assert.equal(accepted.revision,1);
  assert.equal((await second.load()).preferences.base.appearance.palette,'crisp');
  await assert.rejects(second.save(initial),/another preview/);
  await assert.rejects(first.save({...accepted,repoId:'untrusted-evidence-root'}),/repository/);
  assert.throws(()=>createMapPreferenceStore('repo-a',{descriptor:{...descriptor,retention:'derived'}}),/durable/);
  assert.deepEqual(await fs.readdir(path.dirname(path.join(descriptor.path,'maps','viewer-preferences.json'))),['viewer-preferences.json']);
}finally{await fs.rm(root,{recursive:true,force:true});}
console.log('Preferences use durable selected-repository state and reject stale or foreign writes.');
