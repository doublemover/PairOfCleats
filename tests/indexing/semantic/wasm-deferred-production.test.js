import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../../../src/integrations/core/index.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { wasmModule } from '../../helpers/wasm-fixture.js';
import { runSemanticEnrichmentService } from '../../../src/semantic/enrichment.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'poc-wasm-drain-')),repoRoot=path.join(temp,'repo');
await fs.mkdir(repoRoot);
const bytes=wasmModule({functions:[{code:[0x20,0]}],exports:[{name:'run',index:0}]});
await fs.writeFile(path.join(repoRoot,'module.wasm'),bytes);
applyTestEnv({cacheRoot:path.join(temp,'cache'),embeddings:'stub',testConfig:{indexing:{workerPool:{enabled:false},semantic:{enabled:true,profile:'rich',enrichment:{bindings:'off',localFlow:'deferred',crossFileFlow:'off'}},embeddings:{enabled:false},typeInference:false,typeInferenceCrossFile:false,riskAnalysis:false,treeSitter:{enabled:false}}}});
try {
  await buildIndex(repoRoot,{mode:'code',stage:'stage2',incremental:true,'stub-embeddings':true,'scm-provider':'none'});
  const indexDir=getIndexDir(repoRoot,'code',loadUserConfig(repoRoot));
  const initial=await openPublishedSemanticStore({indexDir,repoRoot});
  assert.equal(initial.manifest.completedTasks.length,0);
  const recordsFor = async inventory => {
    const rows = [];
    for (const partition of inventory.manifest.partitions) for await (const row of inventory.store.iterateRows(partition.partitionId, 'semantic_records')) {
      rows.push({ partitionId: partition.partitionId, row });
    }
    return rows;
  };
  const beforeRecords = await recordsFor(initial);
  assert.ok(beforeRecords.some(item => item.row.data?.astKind === 'WasmInstruction'));
  assert.ok(beforeRecords.every(item => !['block', 'value'].includes(item.row.kind)), 'deferred indexing retains structure without solver products');

  const request={schemaVersion:1,repoRoot,generation:initial.manifest.generation,limits:{maxTasks:4,maxBytes:65536,maxMs:5000,drainMaxMs:15000}};
  const plan=await runSemanticEnrichmentService({request});
  assert.equal(plan.tasks.length,1);assert.equal(plan.tasks[0].kind,'localFlow');assert.equal(plan.tasks[0].executable,true);
  const result=await runSemanticEnrichmentService({request:{...request,action:'drain',taskIds:[plan.tasks[0].taskId]}});
  assert.equal(result.status,'published');assert.equal(result.lineage.length,1);
  const fresh=await openPublishedSemanticStore({indexDir:getIndexDir(repoRoot,'code',loadUserConfig(repoRoot)),repoRoot,generation:result.publishedGeneration});
  assert.equal(fresh.manifest.completedTasks.length,1);
  const afterRecords = await recordsFor(fresh);
  assert.deepEqual(afterRecords.filter(item => item.partitionId.startsWith('sy1:')), beforeRecords.filter(item => item.partitionId.startsWith('sy1:')),
    'the granted task preserves every structural reference and row');
  assert.ok(afterRecords.some(item => item.row.kind === 'value'), 'the one granted flow task adds derived values');

  assert.deepEqual(fresh.manifest.partitions.filter(row=>row.partitionId.startsWith('sy1:')).map(row=>row.canonicalHash),initial.manifest.partitions.filter(row=>row.partitionId.startsWith('sy1:')).map(row=>row.canonicalHash));
  const edges=[],coverage=[];
  for(const partition of fresh.manifest.partitions) {
    for await(const edge of fresh.store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(edge);
    for await(const row of fresh.store.iterateRows(partition.partitionId,'semantic_coverage'))coverage.push(row);
  }
  assert.ok(edges.length>0);assert.ok(coverage.some(row=>row.phase==='localFlow'&&row.state==='partial'));
  assert.equal((fresh.manifest.compilerAdmissions||[]).length,0,'binary execution never obtains a compiler grant or measurement receipt');
  const changed=Buffer.from(bytes);changed[changed.length-2]^=1;await fs.writeFile(path.join(repoRoot,'module.wasm'),changed);
  await assert.rejects(runSemanticEnrichmentService({request:{...request,action:'enqueue',generation:fresh.manifest.generation,taskIds:[result.lineage[0].replannedTaskId]}}),/source bytes changed|source size changed/);
  console.log('Deferred binary tasks retain source authority and normal generation publication without a Program');
} finally {await fs.rm(temp,{recursive:true,force:true});}
