import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGraphStore } from '../../src/graph/store.js';
import { createGraphStoreFixture, chunkCallGraphRelations } from './helpers/graph-fixtures.js';

const {tmpDir}=createGraphStoreFixture({prefix:'graph-manifest-snapshot-',graphRelations:chunkCallGraphRelations()});
try{
  const manifest=JSON.parse(await fs.readFile(path.join(tmpDir,'pieces','manifest.json'),'utf8'));
  const store=createGraphStore({indexDir:tmpDir,manifest});
  const alternate='pieces/alternate-graph.json';
  await fs.writeFile(path.join(tmpDir,alternate),JSON.stringify(chunkCallGraphRelations({nodes:[
    {id:'foreign',out:['target'],in:[]},{id:'target',out:[],in:['foreign']}
  ]})));
  manifest.pieces.find(row=>row.name==='graph_relations').path=alternate;
  const request={graphs:['callGraph'],cacheKey:'supplied-cache-key',indexSignature:'selected-generation'};
  const selected=await store.loadGraphIndex(request);
  assert.equal(selected.callGraphIndex.has('chunk-a'),true);
  assert.equal(selected.callGraphIndex.has('foreign'),false,'external inventory mutation cannot rebind admitted graph bytes');
  const different=createGraphStore({indexDir:tmpDir,manifest});
  const changed=await different.loadGraphIndex(request);
  assert.equal(changed.callGraphIndex.has('foreign'),true,'a separately admitted inventory retains its own cache authority');
  assert.equal(changed.callGraphIndex.has('chunk-a'),false);
  assert.notEqual(selected,changed);
}finally{await fs.rm(tmpDir,{recursive:true,force:true});}
console.log('Graph stores pin manifest lookup and cache admission to one owned inventory.');
