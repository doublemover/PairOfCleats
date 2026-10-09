#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createLocalSourceHistoryService } from '../../src/integrations/inference-history/service.js';
import { createHistoryAgentReader } from '../../src/integrations/inference-history/agent-reader.js';
const {values,positionals}=parseArgs({allowPositionals:true,options:{
  collection:{type:'string'},request:{type:'string'},query:{type:'string'},help:{type:'boolean'}}});
if(values.help||!values.collection){
  console.log('pairofcleats history local --collection <manifest.json> search --query <text>\npairofcleats history local --collection <manifest.json> context|references|original --request <JSON>\nManifest: {sources:[{path,sha256}], indexPath?, catalogs?:[{path,sourceRoot}]}. Conversations and artifact shards share this collection.');
}else{
  const file=path.resolve(values.collection);
  if(await fs.realpath(file)!==file)throw new Error('Canonical selected collection required.');
  const stat=await fs.stat(file);if(stat.size>1024*1024)throw new Error('Collection manifest byte limit exceeded.');
  const manifest=JSON.parse(await fs.readFile(file,'utf8'));
  const resolve=value=>path.resolve(path.dirname(file),value);
  const service=await createLocalSourceHistoryService({
    sources:manifest.sources.map(s=>({path:resolve(s.path),sha256:s.sha256})),
    indexPath:manifest.indexPath?resolve(manifest.indexPath):null,
    catalogs:(manifest.catalogs??[]).map(c=>({path:resolve(c.path),sourceRoot:resolve(c.sourceRoot)}))
  });
  try{
    const request=values.request?JSON.parse(values.request):{query:values.query??''};
    const packet=await createHistoryAgentReader({service}).execute(positionals[0]??'search',request,
      {detail:'full',maxOutputBytes:2097152});
    console.log(JSON.stringify(packet));if(!packet.ok)process.exitCode=1;
  }finally{await service.dispose();}
}
