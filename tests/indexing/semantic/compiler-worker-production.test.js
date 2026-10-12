import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir,loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { buildDatabaseFromArtifacts } from '../../../src/storage/sqlite/build/from-artifacts.js';
import { createSqliteSemanticStore } from '../../../src/semantic/sqlite-store.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'poc-worker-production-')),repo=path.join(root,'repo');await fs.mkdir(repo);
const input='export {}; const worker = new Worker(new URL("./worker.ts",import.meta.url),{type:"module"}); const buffer = new ArrayBuffer(16); const view = new Float32Array(buffer); const shared = new SharedArrayBuffer(16); const payload = {values:view,shared}; worker.postMessage(payload,[buffer]); worker.postMessage(shared); worker.postMessage(buffer,[buffer]); declare const dynamic: string; const other = new Worker(new URL(dynamic,import.meta.url)); other.postMessage(1);';
const worker='/// <reference lib="webworker" />\nexport {}; declare const self: DedicatedWorkerGlobalScope; self.addEventListener("message",event => { const value = event.data; console.log(value); });';
await fs.writeFile(path.join(repo,'input.ts'),input);await fs.writeFile(path.join(repo,'worker.ts'),worker);
applyTestEnv({cacheRoot:path.join(root,'cache'),embeddings:'stub',testConfig:{indexing:{workerPool:{enabled:false},semantic:{enabled:true,profile:'rich',enrichment:{crossFileFlow:'eager'}},embeddings:{enabled:false},typeInference:false,typeInferenceCrossFile:false,riskAnalysis:false,treeSitter:{enabled:false}}}});
try {
  await buildIndex(repo,{mode:'code',stage:'stage2',incremental:true,'stub-embeddings':true,'scm-provider':'none'});
  const indexDir=getIndexDir(repo,'code',loadUserConfig(repo)),manifest=JSON.parse(await fs.readFile(path.join(indexDir,'semantic_manifest.json'),'utf8'));
  const {store}=await openPublishedSemanticStore({indexDir,repoRoot:repo,generation:manifest.generation});
  const records=new Map(),edges=[],sources=new Map(),coverage=[];
  for(const partition of manifest.partitions){for await(const row of store.iterateRows(partition.partitionId,'semantic_records'))records.set(partition.partitionId+':'+row.id,{row,partition});for await(const row of store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(row);for await(const row of store.iterateRows(partition.partitionId,'semantic_sources'))sources.set(row.sourceUnitId,row);for await(const row of store.iterateRows(partition.partitionId,'semantic_coverage'))coverage.push(row);}
  const kind=ref=>records.get(ref.partitionId+':'+ref.localId)?.row.data.boundaryKind;
  const receives=[...records.values()].filter(value=>value.row.data.boundaryKind==='worker-source-message-consumer-candidate');assert.equal(receives.length,3);assert.ok(receives.every(value=>sources.get(value.partition.sourceUnitId).path==='worker.ts'));
  assert.ok([...records.values()].some(value=>value.row.kind==='evidence' && value.row.data.producerId==='semantic-storage'),'storage-flow seam persists its separate allocation/field partition');
  const dispatch=edges.find(edge=>edge.kind==='dispatches' && kind(edge.to)==='worker-source-message-consumer-candidate');assert.ok(dispatch);
  const consumer=edges.find(edge=>edge.kind==='consumes' && kind(edge.from)==='worker-source-message-consumer-candidate');assert.ok(consumer);const sourceText=(await store.getSourceSpans([consumer.to]))[0];assert.equal(sourceText.text,'event.data');
  assert.ok(edges.some(edge=>edge.kind==='sharesStorage' && kind(edge.to)==='worker-shared-storage-request'));assert.ok(edges.some(edge=>edge.kind==='transfers' && kind(edge.to)==='worker-transfer-request'));
  assert.ok(edges.filter(edge=>kind(edge.to)==='worker-structured-clone-request').every(edge=>edge.kind!=='copies'));
  assert.ok(coverage.some(row=>row.reason?.includes('worker_entry_dynamic_or_not_in_exact_inventory') && row.state==='partial'));
  const request={repoRoot:repo,generation:manifest.generation,seed:dispatch.from,direction:'downstream',limits:{depth:4}};
  const drain = async currentStore => { const service=createSemanticTraceService(), pages=[], began=Date.now(); let cursor=null;
    do { assert.ok(pages.length<64 && Date.now()-began<10000,'bounded continuation must terminate');const page=await service({store:currentStore,request:{...request,...(cursor?{cursor}:{})}});pages.push(page);cursor=page.cursor;}while(cursor);
    const unique=field=>[...new Map(pages.flatMap(page=>page[field]).map(row=>[JSON.stringify(row),row])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);
    return {pages,records:unique('records'),edges:unique('edges')};
  };
  const trace=await drain(store);assert.ok(trace.records.some(row=>row.ref.partitionId===consumer.to.partitionId && row.ref.localId===consumer.to.localId),JSON.stringify({records:trace.records.map(row=>row.ref),frontier:trace.pages.flatMap(page=>page.frontier)}));assert.ok(trace.pages[0].coverage.analysis.some(row=>row.reason?.includes('runtime_delivery_and_clone_effects_unobserved')));assert.ok(trace.pages[0].frontier.some(row=>row.reason==='analysis_incomplete'));
  const dbPath=path.join(root,'semantic.sqlite');await buildDatabaseFromArtifacts({Database,outPath:dbPath,indexDir,mode:'code',vectorConfig:{},modelConfig:{},emitOutput:false,validateMode:'full',optimize:false});const db=new Database(dbPath,{readonly:true});
  try{const sqlite=createSqliteSemanticStore({db,repoRoot:repo,indexPath:dbPath,artifactSurfaceVersion:manifest.artifactSurfaceVersion,generation:manifest.generation});const sqlTrace=await drain(sqlite);assert.deepEqual(sqlTrace.records,trace.records);assert.deepEqual(sqlTrace.edges,trace.edges);}finally{db.close();}
  console.log('worker-disabled production Worker publication, source-pinned consumers, storage seam and artifact/SQLite trace parity passed');
}finally{await fs.rm(root,{recursive:true,force:true});}
