#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createLocalSourceHistoryService } from '../../src/integrations/inference-history/service.js';
import { createHistoryAgentReader } from '../../src/integrations/inference-history/agent-reader.js';
import { createArchiveEmbeddingRuntime } from '../../src/integrations/inference-history/embedding-runtime.js';

const embeddingNumbers = [
  ['dimensions','dimensions'], ['batch-size','batchSize'], ['lookahead','lookahead'],
  ['max-padded-tokens','maxPaddedTokens'], ['max-attention-tokens','maxAttentionTokens'],
  ['max-cache-inputs','maxCacheInputs'], ['max-cache-bytes','maxCacheBytes']
];
const embeddingStrings = [
  ['task','task'], ['dtype','dtype'], ['graph-sha256','graphSha256'],
  ['model-file-name','modelFileName'], ['tokenizer-identity','tokenizerIdentity'],
  ['numerical-recipe','numericalRecipe']
];
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  'rebuild-discovery':{type:'boolean'},collection:{type:'string'},request:{type:'string'},
  query:{type:'string'},mode:{type:'string'},'models-dir':{type:'string'},
  ...Object.fromEntries([...embeddingNumbers,...embeddingStrings].map(([flag])=>[flag,{type:'string'}])),
  'session-options':{type:'string'},'max-units':{type:'string'},'max-ms':{type:'string'},
  'max-batch-chars':{type:'string'},'allow-downloads':{type:'boolean'},help:{type:'boolean'}}});
if(values.help||!values.collection){
  console.log([
    'pairofcleats history local --collection <manifest.json> search --query <text> [--mode lexical|hybrid|semantic|auto]',
    'pairofcleats history local --collection <manifest.json> embed [--max-units 100] [--max-ms 30000]',
    'pairofcleats history local --collection <manifest.json> embedding-status|embedding-execution-info',
    'pairofcleats history local --collection <manifest.json> context|references|original --request <JSON>',
    'Manifest: {sources:[{path,sha256}],indexPath?,catalogs?:[{path,sourceRoot}],embeddings?:{modelsDir,dtype?,dimensions?,batchSize?,chunkChars?,overlapChars?,allowDownloads?,sessionOptions?,graphSha256?,modelFileName?,tokenizerIdentity?,numericalRecipe?,lookahead?,maxPaddedTokens?,maxAttentionTokens?,maxCacheInputs?,maxCacheBytes?}}.',
    'Archive CPU EG2 defaults: pinned fp32/full768, offline; --models-dir enables EG2. Explicit --allow-downloads permits provisioning.',
    'CPU session options: --session-options <JSON object, max 16384 bytes>; embedding-execution-info reports configuration without opening an index or loading a model.',
    'Graph identity: --graph-sha256 --model-file-name --tokenizer-identity --numerical-recipe. Custom graph files require verified SHA256.',
    'Batch/cache bounds: --batch-size --lookahead --max-padded-tokens --max-attention-tokens --max-batch-chars --max-cache-inputs --max-cache-bytes.',
    'Ctrl-C stops admission, drains up to 1000ms, then terminates the owned CPU worker; stopped requires actual exit confirmation.',
    'embed checkpoints each batch. Repeat to resume after native settlement; embedding-status reports coverage. v1 requires explicit copy conversion.'
  ].join('\n'));
}else{
  const file=path.resolve(values.collection);
  if(await fs.realpath(file)!==file)throw new Error('Canonical selected collection required.');
  const stat=await fs.stat(file);if(stat.size>1024*1024)throw new Error('Collection manifest byte limit exceeded.');
  const manifest=JSON.parse(await fs.readFile(file,'utf8'));
  const resolve=value=>path.resolve(path.dirname(file),value);
  let embeddings=manifest.embeddings??null;
  if(embeddings){
    embeddings={...embeddings,modelsDir:resolve(embeddings.modelsDir)};
    // Manifest output paths are collection-relative; CLI session JSON requires absolute paths.
    if(embeddings.sessionOptions){
      if(Buffer.byteLength(JSON.stringify(embeddings.sessionOptions),'utf8')>16384)throw new Error('Manifest CPU session-options JSON byte limit exceeded.');
      const sessionOptions={...embeddings.sessionOptions};
      for(const key of ['profileFilePrefix','optimizedModelFilePath']){
        if(sessionOptions[key]!==undefined)sessionOptions[key]=resolve(sessionOptions[key]);
      }
      embeddings={...embeddings,sessionOptions};
    }
  }
  if(values['models-dir'])embeddings={...embeddings,modelsDir:path.resolve(values['models-dir'])};
  const set=(key,value)=>{
    if(!embeddings)throw new Error('Configure an archive model directory first.');
    embeddings={...embeddings,[key]:value};
  };
  for(const [flag,key] of embeddingNumbers)if(values[flag]!==undefined)set(key,Number(values[flag]));
  for(const [flag,key] of embeddingStrings)if(values[flag]!==undefined)set(key,values[flag]);
  if(values['session-options']!==undefined){
    if(Buffer.byteLength(values['session-options'],'utf8')>16384)throw new Error('CPU session-options JSON byte limit exceeded.');
    const sessionOptions=JSON.parse(values['session-options']);
    if(!sessionOptions||typeof sessionOptions!=='object'||Array.isArray(sessionOptions))throw new Error('CPU session-options JSON object required.');
    set('sessionOptions',sessionOptions);
  }
  if(values['allow-downloads']!==undefined)set('allowDownloads',values['allow-downloads']);
  const command=positionals[0]??'search';
  if(command==='embedding-execution-info'){
    if(!embeddings)throw new Error('Configure an archive model directory first.');
    const runtime=createArchiveEmbeddingRuntime(embeddings);
    console.log(JSON.stringify({ok:true,execution:runtime.executionInfo()}));
  }else{
    if(command==='embed'&&!manifest.indexPath)throw new Error('Resumable embed requires an explicit persistent archive indexPath.');
    const service=await createLocalSourceHistoryService({
      rebuildDiscovery:values['rebuild-discovery']===true,embeddings,
      sources:manifest.sources.map(s=>({path:resolve(s.path),sha256:s.sha256})),
      indexPath:manifest.indexPath?resolve(manifest.indexPath):null,
      catalogs:(manifest.catalogs??[]).map(c=>({path:resolve(c.path),sourceRoot:resolve(c.sourceRoot)}))
    });
    let cancellation=null;
    const onStop=()=>{
      if(cancellation)return;
      console.error(JSON.stringify({phase:'cancellation-requested'}));
      cancellation=service.cancelEmbeddings('cancelled').then(receipt=>{
        console.error(JSON.stringify({phase:'cancellation-result',...receipt}));
        if(!receipt.workerStopped)process.exitCode=1;
      }).catch(error=>{console.error(JSON.stringify({phase:'cancellation-failed',workerStopped:false,code:error.code??'ERR_INFERENCE_HISTORY_UNAVAILABLE'}));process.exitCode=1;});
    };
    process.on('SIGINT',onStop);process.on('SIGTERM',onStop);
    try{
      if(command==='embedding-status')console.log(JSON.stringify({ok:true,semantic:service.embeddingStatus()}));
      else if(command==='embed'){
        const controls={};
        for(const [flag,key]of [['max-units','maxUnits'],['max-ms','maxMillis'],['max-batch-chars','maxBatchChars'],...embeddingNumbers.filter(([flag])=>flag!=='dimensions')]){
          if(values[flag]!==undefined)controls[key]=Number(values[flag]);
        }
        console.log(JSON.stringify({ok:true,semantic:await service.indexEmbeddings(controls)}));
      }else{
        const request=values.request?JSON.parse(values.request):{query:values.query??''};
        if(values.mode!==undefined)request.mode=values.mode;
        const packet=await createHistoryAgentReader({service}).execute(command,request,{detail:'full',maxOutputBytes:2097152});
        console.log(JSON.stringify(packet));if(!packet.ok)process.exitCode=1;
      }
    }finally{
      process.off('SIGINT',onStop);process.off('SIGTERM',onStop);
      await cancellation;await service.dispose();
    }
  }
}
