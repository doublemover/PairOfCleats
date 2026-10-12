#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readBounded, hashFile, withinTrialRoot, inspectOnnx } from './eg2-qualify-graph.js';
import { qualifyRetrieval } from './eg2-qualify-quality.js';
import { appendTrialReceipt, validateTrialIdentity } from './eg2-qualify.js';
import { createPreparedTextEncoder } from '../../src/shared/embedding-prepared.js';
import { resolveEmbeddingModelProfile } from '../../src/shared/embedding-model-profile.js';

export function validateTrialSamples(samples, identity) {
  validateTrialIdentity(samples?.reference?.identity);
  const documents=samples.documents,queries=samples.queries;
  if(!Array.isArray(documents)||!documents.length||documents.length>192||!Array.isArray(queries)||!queries.length||queries.length>24)
    throw new Error('Trial requires 1..192 documents and 1..24 queries.');
  if(identity.dimensions!==768||identity.maxLength!==8192)throw new Error('First CPU trial requires canonical 768d/8192-token contract.');
  const reference=samples.reference;
  for(const [name,items] of [['documents',documents],['queries',queries]]) {
    const baseline=new Map((reference[name]??[]).map(item=>[item.id,item]));
    const seen=new Set();
    for(const row of items) {
      if(typeof row.id!=='string'||!row.id||seen.has(row.id)||typeof row.text!=='string'||!row.text.length||row.text.length>4000)
        throw new Error('Unique IDs and bounded exact text required.');
      seen.add(row.id);
      const previous=baseline.get(row.id),prefix=name==='documents'?identity.documentPrefix:identity.queryPrefix;
      if(!previous||previous.effectiveInput!==prefix+row.text)throw new Error('Baseline must certify the exact same effective input for '+row.id);
    }
    if(baseline.size!==items.length)throw new Error('Baseline coverage differs from selected trial.');
  }
  if(reference.identity.dimensions!==768||reference.identity.maxLength!==identity.maxLength
    ||reference.identity.modelRevision!==identity.modelRevision||reference.identity.tokenizerSha256!==identity.tokenizerSha256
    ||reference.identity.documentPrefix!==identity.documentPrefix||reference.identity.queryPrefix!==identity.queryPrefix)
    throw new Error('Reference and candidate text/tokenizer/prompt contracts differ.');
  return samples;
}

/** Explicitly invoked small CPU-only pilot. Never accesses a selected archive DB. */
export async function runCpuTrial({trialRoot,manifestFile,loadTransformers=()=>import('@huggingface/transformers')}) {
  const root=await fs.realpath(trialRoot);
  const marker=JSON.parse(await readBounded(await withinTrialRoot(path.join(root,'trial-manifest.json'),root),1024*1024));
  if(marker.schema!=='eg2.cpu-trial.v1')throw new Error('Dedicated trial marker required.');
  const identity=validateTrialIdentity(marker.identity);
  const manifest=JSON.parse(await readBounded(await withinTrialRoot(manifestFile,root),1024*1024));
  if(manifest.schema!=='eg2.cpu-execution.v1'||manifest.maxMillis<1000||manifest.maxMillis>120000
    ||!Number.isInteger(manifest.maxMillis)||manifest.batchSize!==4)
    throw new Error('Explicit <=120-second cooperative budget and batch 4 required.');
  const modelDirectory=await fs.realpath(await withinTrialRoot(manifest.modelDirectory,root));
  const samplesFile=await withinTrialRoot(manifest.samples,root);
  const samples=validateTrialSamples(JSON.parse(await readBounded(samplesFile,4*1024*1024)),identity);
  if(!Array.isArray(manifest.artifacts)||manifest.artifacts.length<4||manifest.artifacts.length>24)throw new Error('Verified staged model artifacts required.');
  const artifactReceipts=[];
  for(const artifact of manifest.artifacts) {
    const file=await withinTrialRoot(path.resolve(modelDirectory,artifact.path),root);
    if(!/^[a-f0-9]{64}$/.test(artifact.sha256??''))throw new Error('Verified artifact hash required.');
    const actual=await hashFile(file);
    if(actual!==artifact.sha256)throw new Error('Trial artifact hash mismatch: '+artifact.path);
    artifactReceipts.push({...artifact,sha256:actual});
  }
  const primaryWeight=artifactReceipts.filter(row=>row.path.endsWith('.onnx_data'));
  if(primaryWeight.length!==1||primaryWeight[0].sha256!==identity.modelSha256)throw new Error('First trial requires one exact pinned external-weight hash matching identity.');
  const graph=await withinTrialRoot(path.join(modelDirectory,'onnx/model_w8a8.onnx'),root);
  if(await hashFile(graph)!==identity.graphSha256)throw new Error('Candidate graph differs from trial identity.');
  const inspected=inspectOnnx(await readBounded(graph)).report;
  if(!inspected.nbits.length||inspected.nbits.some(node=>node.bits!==8||node.accuracyLevel!==4))
    throw new Error('First candidate must be explicit W8 accuracy_level4 on all NBits nodes.');
  for(const entry of inspected.externalData) {
    const external=path.resolve(path.dirname(graph),entry.location??'');
    if(!entry.location||!artifactReceipts.some(row=>path.resolve(modelDirectory,row.path)===external))
      throw new Error('Every external-data file must appear in verified artifact receipt.');
  }
  for(const required of ['config.json','tokenizer.json','tokenizer_config.json','onnx/model_w8a8.onnx'])
    if(!artifactReceipts.some(row=>row.path===required))throw new Error('Missing canonical staged artifact: '+required);
  if(artifactReceipts.find(row=>row.path==='tokenizer.json').sha256!==identity.tokenizerSha256)throw new Error('Tokenizer differs from identity.');
  const output=await withinTrialRoot(path.join(root,'cpu-trial-outputs.json'),root);
  const receiptFile=await withinTrialRoot(path.join(root,'cpu-trial-receipt.json'),root);
  const optimized=await withinTrialRoot(path.join(root,'optimized-model.onnx'),root);
  for(const file of [output,receiptFile,optimized]) {
    try {await fs.stat(file);throw new Error('Prior trial artifact exists; no retry/overwrite.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const sessionOptions={intraOpNumThreads:2,interOpNumThreads:1,executionMode:'sequential',enableProfiling:true,
    profileFilePrefix:path.join(root,'ort-cpu-profile'),optimizedModelFilePath:optimized,logSeverityLevel:1,
    extra:{'session.intra_op.allow_spinning':'0','session.inter_op.allow_spinning':'0'}};
  const processIdentity={pid:process.pid,parentPid:process.ppid,runId:randomUUID(),
    nodeStartedAt:new Date(performance.timeOrigin).toISOString(),
    startTimestampSource:'Node performance.timeOrigin; not OS creation-time verification',
    parentOwnershipVerified:false,ownedLineage:[{pid:process.pid,parentPid:process.ppid,
      role:'qualification-invocation',ownershipEvidence:'self-reported current process only'}]};
  const receipt={schema:'eg2.cpu-execution-receipt.v1',startedAt:new Date().toISOString(),identity,processIdentity,
    sampleSha256:await hashFile(samplesFile),artifacts:artifactReceipts,sessionOptions,
    concurrency:1,batchSize:4,maxMillis:manifest.maxMillis,timeoutSemantics:'Cooperative batch boundaries; native inference cannot be interrupted. No automatic resubmission.',
    timingContext:'Concurrent with live CPU indexing; no uncontended speedup claim.',state:'loading'};
  await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  let encoder=null;const started=performance.now();
  const save=async()=>fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n');
  const checkDeadline=()=>{if(performance.now()-started>=manifest.maxMillis)throw new Error('Cooperative trial deadline reached; no further submission.');};
  try {
    const mod=await loadTransformers();
    const runtimeRequire=createRequire(import.meta.resolve('@huggingface/transformers'));
    const ortEntry=runtimeRequire.resolve('onnxruntime-node');
    const ortPackage=JSON.parse(await fs.readFile(path.join(path.dirname(ortEntry),'..','package.json'),'utf8'));
    receipt.observedRuntime={transformersVersion:mod.env?.version,onnxRuntimeVersion:ortPackage.version,onnxRuntimeEntry:ortEntry};
    if(ortPackage.version!=='1.30.0')throw new Error('Actual ONNX Runtime version differs from qualified1.30.0.');
    if(mod.env?.version!=='4.3.1'||identity.runtimeVersion!=='transformers.js@4.3.1/onnxruntime-node@1.30.0')throw new Error('Qualified runtime identity required.');
    mod.env.allowRemoteModels=false;mod.env.allowLocalModels=true;
    const options={local_files_only:true,revision:identity.modelRevision};
    const config=await mod.AutoConfig.from_pretrained(modelDirectory,options);
    if(config.model_type!=='embedding_gemma2')throw new Error('Unexpected model architecture.');
    config.vision_config=null;config.audio_config=null;
    const tokenizer=await mod.AutoTokenizer.from_pretrained(modelDirectory,options);
    // fp32 is only the filename suffix selector here. The verified graph itself is W8 accuracy_level4.
    const model=await mod.AutoModel.from_pretrained(modelDirectory,{...options,config,device:'cpu',dtype:'fp32',
      model_file_name:'model_w8a8',use_external_data_format:false,session_options:sessionOptions});
    const profile=resolveEmbeddingModelProfile('onnx-community/embeddinggemma-2-ONNX',{revision:identity.modelRevision,dtype:'q8',dimensions:768});
    encoder=createPreparedTextEncoder({tokenizer,model,Tensor:mod.Tensor,profile,sessionOptions});
    receipt.state='encoding';await save();
    const candidate={identity,documents:[],queries:[]};
    for(const [name,rows]of [['documents',samples.documents],['queries',samples.queries]]) {
      const prefix=name==='documents'?identity.documentPrefix:identity.queryPrefix;
      for(let start=0;start<rows.length;start+=4) {
        checkDeadline();
        const batch=rows.slice(start,start+4),effective=batch.map(row=>prefix+row.text);
        // Reject lost coverage before the bounded encoder applies its truncation ceiling.
        for(const text of effective) {
          const tokenized=await tokenizer(text,{padding:false,truncation:false,return_tensor:false});
          const count=tokenized.input_ids?.length;
          if(!Number.isInteger(count)||count>8192)throw new Error('Selected input exceeds exact token ceiling.');
        }
        const prepared=await encoder.prepare(effective);
        const vectors=await encoder.embedPrepared(prepared);
        checkDeadline(); // Late native outputs are not committed as accepted samples.
        candidate[name].push(...batch.map((row,index)=>({id:row.id,effectiveInput:effective[index],vector:Array.from(vectors[index])})));
        receipt.completedDocuments=candidate.documents.length;receipt.completedQueries=candidate.queries.length;
        receipt.execution=encoder.executionInfo();await save();
      }
    }
    const paired={reference:samples.reference,candidate,k:samples.k??10,judgments:samples.judgments??{}};
    receipt.quality=qualifyRetrieval(paired);
    await fs.writeFile(output,JSON.stringify(paired,null,2)+'\n',{flag:'wx'});
    receipt.outputsSha256=await hashFile(output);
    receipt.profiling=await encoder.endProfiling();
    if(receipt.profiling.sessions.some(row=>row.status!=='ended'))throw new Error('Profile collection incomplete; inspect before any repeat.');
    receipt.execution=encoder.executionInfo();receipt.state='disposing';await save();
    await encoder.dispose();encoder=null;
    receipt.state='completed';receipt.endedAt=new Date().toISOString();receipt.elapsedMs=performance.now()-started;
    receipt.optimizedGraph=inspectOnnx(await readBounded(optimized)).report;
    await save();await appendTrialReceipt(root,receipt);return receipt;
  }catch(error) {
    receipt.state='failed';receipt.error=error.message;receipt.execution=encoder?.executionInfo()??null;await save();
    if(encoder) {
      receipt.disposalStartedAt=new Date().toISOString();await save();
      try{await encoder.dispose();receipt.disposalCompletedAt=new Date().toISOString();}
      catch(disposal){receipt.disposalError=disposal.message;}
      await save();
    }
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{run:{type:'boolean'},'trial-root':{type:'string'},manifest:{type:'string'},help:{type:'boolean'}}});
  if(values.help||!values.run)console.log('Explicit CPU trial: node tools/history/eg2-qualify-run.js --run --trial-root <dedicated trial> --manifest <cpu-execution.json>. Does native inference only when --run supplied. Coordinate CPU budget first.');
  else runCpuTrial({trialRoot:values['trial-root'],manifestFile:values.manifest}).then(receipt=>console.log(JSON.stringify({ok:true,state:receipt.state,quality:receipt.quality})))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
