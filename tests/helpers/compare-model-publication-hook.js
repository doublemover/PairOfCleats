import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
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
  let lastSearch=null;
  if(plan.corpusReadEvidence){
    const descriptors=new Map(),openSync=fs.openSync,readSync=fs.readSync,closeSync=fs.closeSync;
    const admit=filename=>path.basename(String(filename))==='chunk_meta.json'?(owned(filename),true):false;
    const record=(filename,fd)=>({...lastSearch,path:path.resolve(filename),fd,hash:createHash('sha256'),bytes:0,calls:0});
    const note=(entry,buffer,offset,length)=>{entry.calls++;entry.bytes+=length;
      entry.hash.update(Buffer.from(buffer.buffer,buffer.byteOffset+offset,length));};
    const finish=entry=>{const {hash,calls,...value}=entry;
      fs.appendFileSync(owned(plan.corpusReadEvidence),JSON.stringify({...value,readCalls:calls,sha256:hash.digest('hex'),originalCloseConfirmed:true})+'\n');};
    fs.openSync=function(filename,...args){
      const observed=admit(filename),fd=Reflect.apply(openSync,fs,[filename,...args]);
      if(observed)descriptors.set(fd,record(filename,fd));return fd;
    };
    fs.readSync=function(fd,buffer,...args){
      const result=Reflect.apply(readSync,fs,[fd,buffer,...args]),entry=descriptors.get(fd);
      if(entry)note(entry,buffer,typeof args[0]==='object'?(args[0].offset||0):(args[0]||0),result);return result;
    };
    fs.closeSync=function(fd,...args){
      const result=Reflect.apply(closeSync,fs,[fd,...args]),entry=descriptors.get(fd);
      if(entry){descriptors.delete(fd);finish(entry);}return result;
    };
    const open=fsPromises.open;
    fsPromises.open=async function(filename,...args){
      const admitted=admit(filename);
      const handle=await Reflect.apply(open,fsPromises,[filename,...args]);
      if(!admitted)return handle;
      const read=handle.read,close=handle.close,observed=record(filename,handle.fd);let closed=false;
      handle.read=async function(...input){
        const result=await Reflect.apply(read,handle,input);
        const buffer=ArrayBuffer.isView(input[0])?input[0]:input[0].buffer,offset=ArrayBuffer.isView(input[0])?(input[1]||0):(input[0].offset||0);
        note(observed,buffer,offset,result.bytesRead);return result;
      };
      handle.close=async function(...input){
        const result=await Reflect.apply(close,handle,input);
        if(!closed){closed=true;finish(observed);}
        return result;
      };
      return handle;
    };
  }
  childProcess.spawnSync=function(command,args,options) {
    const isSearch=args?.some(arg=>path.basename(String(arg))==='search.js');
    const model=options?.env?.PAIROFCLEATS_MODEL;
    if(!isSearch)return original.call(this,command,args,options);
    const number=(counts.get(model)||0)+1;counts.set(model,number);
    lastSearch={model,number};
    const active=model===plan.model&&number===plan.query;
    const publication=plan.pointerByQuery?.find(value=>value.model===model&&value.number===number);
    if(publication){atomicWriteJsonSync(owned(publication.pointerPath),publication.pointer,{durable:true});
      witness({event:'published-before-real-search',model,number,pointer:publication.pointer});}
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
