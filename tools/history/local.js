#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createLocalSourceHistoryService } from '../../src/integrations/inference-history/service.js';
import { createHistoryAgentReader } from '../../src/integrations/inference-history/agent-reader.js';
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  'rebuild-discovery':{type:'boolean'},collection:{type:'string'},request:{type:'string'},
  query:{type:'string'},mode:{type:'string'},'models-dir':{type:'string'},dtype:{type:'string'},
  task:{type:'string'},dimensions:{type:'string'},'batch-size':{type:'string'},'max-units':{type:'string'},
  'max-ms':{type:'string'},'max-batch-chars':{type:'string'},'allow-downloads':{type:'boolean'},
  help:{type:'boolean'}}});
if(values.help||!values.collection){
  console.log([
    'pairofcleats history local --collection <manifest.json> search --query <text> [--mode lexical|hybrid|semantic|auto]',
    'pairofcleats history local --collection <manifest.json> embed [--max-units 100] [--max-ms 30000]',
    'pairofcleats history local --collection <manifest.json> embedding-status',
    'pairofcleats history local --collection <manifest.json> context|references|original --request <JSON>',
    'Manifest: {sources:[{path,sha256}],indexPath?,catalogs?:[{path,sourceRoot}],embeddings?:{modelsDir,dtype?,dimensions?,batchSize?,chunkChars?,overlapChars?,allowDownloads?}}.',
    'Archive EG2 defaults: pinned fp32/768, offline; --models-dir enables EG2. Explicit --allow-downloads permits provisioning. Code-search default remains unchanged.',
    'embed checkpoints each batch in the archive database. Repeat embed to resume; inspect coverage with embedding-status.'
  ].join('\n'));
}else{
  const file=path.resolve(values.collection);
  if(await fs.realpath(file)!==file)throw new Error('Canonical selected collection required.');
  const stat=await fs.stat(file);if(stat.size>1024*1024)throw new Error('Collection manifest byte limit exceeded.');
  const manifest=JSON.parse(await fs.readFile(file,'utf8'));
  const resolve=value=>path.resolve(path.dirname(file),value);
  let embeddings=manifest.embeddings??null;
  if(embeddings)embeddings={...embeddings,modelsDir:resolve(embeddings.modelsDir)};
  if(values['models-dir'])embeddings={...embeddings,modelsDir:path.resolve(values['models-dir'])};
  const numeric=(name,key)=>{if(values[name]!==undefined){if(!embeddings)throw new Error('Configure an archive model directory first.');embeddings={...embeddings,[key]:Number(values[name])};}};
  numeric('dimensions','dimensions');numeric('batch-size','batchSize');
  if(values.task!==undefined){if(!embeddings)throw new Error('Configure an archive model directory first.');embeddings={...embeddings,task:values.task};}
  if(values.dtype!==undefined){if(!embeddings)throw new Error('Configure an archive model directory first.');embeddings={...embeddings,dtype:values.dtype};}
  if(values['allow-downloads']!==undefined){if(!embeddings)throw new Error('Configure an archive model directory first.');embeddings={...embeddings,allowDownloads:values['allow-downloads']};}
  const command=positionals[0]??'search';
  if(command==='embed'&&!manifest.indexPath)throw new Error('Resumable embed requires an explicit persistent archive indexPath.');
  const service=await createLocalSourceHistoryService({
    rebuildDiscovery:values['rebuild-discovery']===true,embeddings,
    sources:manifest.sources.map(s=>({path:resolve(s.path),sha256:s.sha256})),
    indexPath:manifest.indexPath?resolve(manifest.indexPath):null,
    catalogs:(manifest.catalogs??[]).map(c=>({path:resolve(c.path),sourceRoot:resolve(c.sourceRoot)}))
  });
  try{
    if(command==='embedding-status')console.log(JSON.stringify({ok:true,semantic:service.embeddingStatus()}));
    else if(command==='embed'){
      const controls={};
      for(const [flag,key]of [['max-units','maxUnits'],['max-ms','maxMillis'],['batch-size','batchSize'],['max-batch-chars','maxBatchChars']])if(values[flag]!==undefined)controls[key]=Number(values[flag]);
      console.log(JSON.stringify({ok:true,semantic:await service.indexEmbeddings(controls)}));
    }else{
      const request=values.request?JSON.parse(values.request):{query:values.query??''};
      if(values.mode!==undefined)request.mode=values.mode;
      const packet=await createHistoryAgentReader({service}).execute(command,request,{detail:'full',maxOutputBytes:2097152});
      console.log(JSON.stringify(packet));if(!packet.ok)process.exitCode=1;
    }
  }finally{await service.dispose();}
}
