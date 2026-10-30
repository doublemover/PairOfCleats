import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../helpers/test-env.js';
import { createCompatibilityIndex } from '../helpers/index-compatibility-fixture.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
const repo = await fs.mkdtemp(path.join(os.tmpdir(),'poc-supervised-search-'));
applyTestEnv({cacheRoot:path.join(repo,'cache')});
const index = await createCompatibilityIndex(repo,{compatibilityKey:'supervised-search',profileId:'default',published:true});
await fs.writeFile(path.join(index,'chunk_meta.json'),JSON.stringify([{id:0,file:'src/item.js',kind:'FunctionDeclaration',name:'item',start:0,end:1,chunkUid:'uid:item'}]));
const session = createSupervisorSession({timeoutMs:8000});
try {
  await session.waitForEvent(event=>event.event==='hello');
  for(const [jobId,backend,expected] of [['first','memory','done'],['invalid','memory','failed'],['recovery','memory','done']]) {
    session.send({op:'job:run',jobId,title:jobId,argv:['search','--repo',repo,'--backend',backend,'--mode','code','--json','--compact','--no-comments','--type','FunctionDeclaration',...(jobId==='invalid'?['--cursor','invalid-cursor']:[])],resultPolicy:{captureStdout:'json'}});
    const end=await session.waitForEvent(event=>event.event==='job:end'&&event.jobId===jobId);
    assert.equal(end.status,expected,JSON.stringify(end));
    if(expected==='done') assert.equal(end.result?.code?.[0]?.name,'item',JSON.stringify(end));
  }
  assert.equal(await session.shutdown(),0);
  console.log('real supervised searches survive a failed command and shut down cleanly');
} finally {
  if(session.child.exitCode===null) {session.forceKill();await session.waitForExit();}
  await fs.rm(repo,{recursive:true,force:true});
}
