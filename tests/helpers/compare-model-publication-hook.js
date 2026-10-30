import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { atomicWriteJsonSync } from '../../src/shared/io/atomic-write.js';

// Explicit test-only process-boundary hook. Every search child still executes
// the real CLI; only the declared publication/response-fault boundary is added.
if(path.basename(process.argv[1]||'')==='compare-models.js') {
  if(process.env.PAIROFCLEATS_TESTING!=='1')throw new Error('Comparison publication hook requires the test environment.');
  const planPath=new URL(import.meta.url).searchParams.get('plan');
  if(!planPath||!path.isAbsolute(planPath))throw new Error('Explicit comparison test plan required.');
  const plan=JSON.parse(fs.readFileSync(planPath,'utf8')),counts=new Map(),original=childProcess.spawnSync;
  const owned=filename=>{
    const relative=path.relative(plan.rootDir,path.resolve(filename));
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Comparison fault path is outside its unique fixture.');
    return filename;
  };
  const witness=event=>fs.appendFileSync(owned(plan.witness),JSON.stringify(event)+'\n');
  childProcess.spawnSync=function(command,args,options) {
    const isSearch=args?.some(arg=>path.basename(String(arg))==='search.js');
    const model=options?.env?.PAIROFCLEATS_MODEL;
    if(!isSearch)return original.call(this,command,args,options);
    const number=(counts.get(model)||0)+1;counts.set(model,number);
    const active=model===plan.model&&number===plan.query;
    if(active&&plan.pointer){atomicWriteJsonSync(owned(plan.pointerPath),plan.pointer,{durable:true});
      witness({event:'published-before-real-search',model,number,pointer:plan.pointer});}
    const result=original.call(this,command,args,options);
    if(result.status===0&&plan.generationEvidence) {
      const actual=JSON.parse(String(result.stdout));
      fs.appendFileSync(owned(plan.generationEvidence),JSON.stringify({model,number,
        generations:Object.fromEntries(Object.entries(actual.retrieval.freshness.byMode).map(([mode,value])=>[mode,
          {generationKey:value.generationKey,buildId:value.buildId,activeBuildRoot:value.activeBuildRoot}]))})+'\n');
    }
    if(active&&(plan.omitGeneration||plan.changeGeneration||plan.oversizeGeneration)&&result.status===0) {
      const payload=JSON.parse(String(result.stdout));
      if(plan.omitGeneration)delete payload.retrieval.freshness.byMode[plan.omitGeneration].activeBuildRoot;
      if(plan.changeGeneration)payload.retrieval.freshness.byMode[plan.changeGeneration].buildId='changed-response-generation';
      if(plan.oversizeGeneration)payload.retrieval.freshness.byMode[plan.oversizeGeneration].generationKey='x'.repeat(4097);
      const text=JSON.stringify(payload),bytes=Buffer.isBuffer(result.stdout)?Buffer.from(text):text;
      result.stdout=bytes;if(result.output)result.output[1]=bytes;
      witness({event:'actual-response-generation-fault-by-named-boundary-adapter',model,number});
    }
    if(active&&plan.retire&&result.status===0) {
      const target=owned(plan.retire.path),stat=fs.lstatSync(target,{bigint:true});
      if(stat.isSymbolicLink()||!stat.isDirectory()||stat.dev.toString()!==plan.retire.dev||stat.ino.toString()!==plan.retire.ino)throw new Error('Original retired-fixture identity changed.');
      fs.rmSync(target,{recursive:true,force:false});witness({event:'retired-after-real-search-before-corpus-admission',model,number});
    }
    return result;
  };
  syncBuiltinESMExports();
}
