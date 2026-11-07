import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
const outDir=resolveTestCachePath(process.cwd(),`graph-distinct-cap-${crypto.randomUUID()}`);
const link=uid=>({to:{status:'resolved',resolved:{chunkUid:uid}}});
try {
  await fs.mkdir(outDir,{recursive:true});
  const chunks=[{file:'a.js',chunkUid:'A',codeRelations:{callLinks:[link('B'),link('B'),link('C'),link('D'),link('D')]}},...['B','C','D'].map(chunkUid=>({file:`${chunkUid}.js`,chunkUid}))];
  await enqueueGraphRelationsArtifacts({chunks,outDir,caps:{maxEdges:2,maxNodes:10},maxJsonBytes:16384,enqueueWrite:(_label,job)=>job(),addPieceFile:()=>{},formatArtifactLabel:value=>value,removeArtifact:async()=>{},log:()=>{}});
  const meta=JSON.parse(await fs.readFile(path.join(outDir,'graph_relations.meta.json'),'utf8'));
  assert.equal(meta.extensions.graphs.callGraph.edgeCount,2);
  assert.equal(meta.extensions.caps.callGraph.droppedEdges,1,'duplicate omitted links count once');
  const parts=await Promise.all(meta.parts.map(part=>fs.readFile(path.join(outDir,part.path),'utf8')));
  const rows=parts.flatMap(text=>text.trim().split('\n').map(JSON.parse));
  assert.deepEqual(rows.find(row=>row.graph==='callGraph'&&row.node.id==='A').node.out,['B','C']);
  assert.deepEqual(rows.find(row=>row.graph==='callGraph'&&row.node.id==='D').node.in,[]);
} finally {await fs.rm(outDir,{recursive:true,force:true});}
console.log('graph distinct edge caps passed');
