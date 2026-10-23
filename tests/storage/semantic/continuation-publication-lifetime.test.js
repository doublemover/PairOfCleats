import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticServingFixture } from '../../helpers/semantic-serving-fixture.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { createSemanticDetailRunner } from '../../../src/integrations/tooling/semantic-detail.js';
import { createSemanticFindRunner } from '../../../src/integrations/tooling/semantic-find.js';
import { createSemanticTraceRunner } from '../../../src/integrations/tooling/semantic-trace.js';
import { createSemanticExplainRunner } from '../../../src/integrations/tooling/semantic-explain.js';
import { withContainedFile, getContainedFileSession } from '../../../src/shared/contained-file.js';

const fixture = await createSemanticServingFixture({ withTraceEdge: true });
const originalOpen = fs.open, retained = new Map();
try {
  const opened = await openPublishedSemanticStore({ indexDir:fixture.indexDir,repoRoot:fixture.root,generation:fixture.generation,requireQueryIndex:true });
  const scope={repoRoot:fixture.root,generation:fixture.generation,limits:{records:1}};
  const options={userConfig:{indexing:{semantic:{query:{maxContinuations:1}}}}};
  const cases=[
    [createSemanticDetailRunner,{...scope,refs:[fixture.ref,{...fixture.ref,localId:1}]}],
    [createSemanticFindRunner,{...scope,selector:{field:'astKind',value:'Identifier'}}],
    [createSemanticTraceRunner,{...scope,seed:fixture.ref,direction:'downstream',kinds:['flowsTo']}],
    [createSemanticExplainRunner,{...scope,seed:fixture.ref,direction:'downstream',kinds:['flowsTo']}]
  ];
  for(const [create,request] of cases) for(const seam of ['scope','store','cancel']) {
    let failing=false,deny=true,state;
    const controller=new AbortController();
    fs.open=async(file,...args)=>{
      const handle=await originalOpen(file,...args);
      if(path.resolve(String(file))!==path.resolve(fixture.original))return handle;
      const close=handle.close,read=handle.read;state={handle,reads:0,closes:0};retained.set(handle,()=>close.call(handle));
      handle.read=function(...readArgs){state.reads++;return read.call(handle,...readArgs);};
      handle.close=async function(){state.closes++;if(deny)throw Object.freeze(new Error('original publication-boundary close failed'));const value=await close.call(handle);retained.delete(handle);return value;};
      return handle;
    };
    const hold=()=>withContainedFile(fixture.root,fixture.original,descriptor=>descriptor.read(Buffer.alloc(1),0,1,0));
    const runner=create({openStore:async()=>({...opened,
      store:seam==='scope'?{...opened.store,withReadScope:run=>opened.store.withReadScope(async()=>{
        const page=await run();if(failing)await hold();return page;
      })}:opened.store,
      close:async()=>{if(!failing)return;if(seam==='store')await hold();if(seam==='cancel')controller.abort();}
    })});
    const first=await runner(request,options);assert.ok(first.cursor);
    failing=true;
    let failure;try{await runner(request,{...options,signal:controller.signal});assert.fail('failed page publication must be withheld');}catch(error){failure=error;}
    if(seam==='cancel')assert.equal(failure.code,'ABORT_ERR');
    else{
      assert.equal(failure.cacheOwnershipReleased(),false);assert.equal(state.closes,1);
      deny=false;await getContainedFileSession(failure).releaseAfterClose();
      assert.equal(state.handle.fd,-1);assert.equal(state.closes,2);assert.equal(state.reads,1);
      assert.equal(failure.cacheOwnershipReleased(),true);
    }
    failing=false;fs.open=originalOpen;
    const resumed=await runner({...request,cursor:first.cursor},options);
    assert.ok(resumed.records.length,'failed or cancelled pages cannot evict the last delivered cursor');
  }
}finally{fs.open=originalOpen;for(const close of retained.values())await close();await fixture.cleanup();}
console.log('Detail/find/trace/explain commit continuations only after their original reader and store owners settle.');
