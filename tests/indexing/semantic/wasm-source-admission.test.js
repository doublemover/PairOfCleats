import {resolveSemanticSourcePolicy,validateSemanticSourceTargets} from '../../../src/index/semantic/policy.js';
import { persistSemanticCacheEntry, openSemanticCacheEntry } from '../../../src/index/build/incremental/semantic-cache.js';
import { createSemanticCacheDependencySignatures } from '../../../src/index/build/incremental/semantic-cache-dependencies.js';
import { collectStandaloneWasm } from '../../../src/index/semantic/wasm/standalone.js';
import { createFileProcessorForTest, createScannedFileEntry } from '../file-processor/file-processor-fixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { wasmModule } from '../../helpers/wasm-fixture.js';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { isCodeEntryForPath } from '../../../src/index/build/mode-routing.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { resolvePreCpuFileContent } from '../../../src/index/build/file-processor/pre-cpu-content.js';
import { validateSemanticEnvelope } from '../../../src/contracts/validators/semantic-envelopes.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-wasm-source-'));
const bytes = wasmModule({ functions: [{ code: [0x20,0] }], exports: [{ name: 'run', index: 0 }] });
try {
  const fixture = await createCompilerBoundaryFixture(root, {
    'main.ts': `import {readFileSync} from 'node:fs';
      const bytes = new Uint8Array([${[...bytes]}]); const m = new WebAssembly.Module(bytes); const instance=new WebAssembly.Instance(m); instance.exports.run(1);
      const response = await fetch(new URL('./module.wasm',import.meta.url));
      const result = await WebAssembly.instantiateStreaming(response); result.instance.exports.run(2);
      const compiled = await WebAssembly.compileStreaming(fetch(new URL('./module.wasm',import.meta.url))); new WebAssembly.Instance(compiled).exports.run(3);
      const copied = [...[${[...bytes]}]]; const dynamic = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(copied))); dynamic.exports.run(4);
      const file = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL('./module.wasm',import.meta.url)))); file.exports.run(5);
      const streamed = await WebAssembly.instantiateStreaming(new Response(new Uint8Array([${[...bytes]}]), {headers:{'Content-Type':'application/wasm'}})); streamed.instance.exports.run(7);
      const body = await (await fetch(new URL('./module.wasm',import.meta.url))).arrayBuffer(); const bufferInstance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(body))); bufferInstance.exports.run(6);`,
    'unknown.ts': `export {}; declare const url:string; WebAssembly.instantiateStreaming(fetch(url)); WebAssembly.compileStreaming(fetch(new URL('./missing.wasm',import.meta.url))); const changed=new Uint8Array([${[...bytes]}]); changed[0]=1; new WebAssembly.Module(changed);`
  }, { 'module.wasm': bytes });
  const { group, state, policy, syntaxPartitions, stagingRoot, storeFor } = fixture;
  assert.ok(isCodeEntryForPath({ ext: '.wasm', relPath: 'module.wasm' }));
  const retained = [...group.wasmModules.values()][0];
  assert.equal(retained.source.encoding, 'binary'); assert.equal(retained.source.textLength, 0);
  assert.ok(validateSemanticEnvelope('source', retained.source).ok);
  assert.ok(!validateSemanticEnvelope('source', { ...retained.source, coordinateUnit: 'utf16' }).ok);
  await fs.writeFile(path.join(root,'module.wasm'), 'changed working tree');
  assert.deepEqual(await retained.readBytes(), bytes, 'joins use retained bytes, not working-tree content');
  const artifacts = { fileBuffer: bytes };
  const content = await resolvePreCpuFileContent({ wasmBinary: true, artifacts, throwIfAborted() {}, updateCrashStage() {} });
  assert.equal(content.skip, null); assert.equal(artifacts.text, ''); assert.equal(artifacts.fileEncoding, 'binary');
  const cpu = await processFileCpu({ semantic: { policy, stagingRoot, repositoryNamespace: root, storage: { generation: {baseBuildId:'cpu',semanticRevision:0}, relativePath:'semantic' }, diskAccount: state.semanticDiskAccount }, sourceBytes: bytes,
    timing:{},mode:'code',ext:'.wasm',relKey:'cpu.wasm',root, languageOptions: {}, fileStat:{size:bytes.length} });
  assert.equal(cpu.semanticFactsRef.partitions.length, 2); assert.deepEqual(cpu.chunks, []);
  const dependencySignatures = {parse:'wasm-fixture'};
  const dependencies = createSemanticCacheDependencySignatures({dependencySignatures,policy,root});
  const cacheOptions = {repoRoot:root,bundleDir:path.join(root,'binary-cache'),buildRoot:root,factsRef:cpu.semanticFactsRef,dependencySignatures:dependencies,diskAccount:state.semanticDiskAccount};
  const locator = await persistSemanticCacheEntry(cacheOptions);
  await openSemanticCacheEntry({...cacheOptions,locator,expectedDependencySignatures:dependencies});
  const offPolicy = {...policy,enrichment:{...policy.enrichment,localFlow:'off'}};
  const offDependencies = createSemanticCacheDependencySignatures({dependencySignatures,policy:offPolicy,root});
  assert.equal(offDependencies.semantic,dependencies.semantic,'analysis changes keep shared syntax identity');
  await assert.rejects(openSemanticCacheEntry({...cacheOptions,locator,expectedDependencySignatures:offDependencies}),{code:'ERR_SEMANTIC_CACHE_MISMATCH'},'derived binary analysis uses the existing replay policy fence');
  const collectPolicy = policy => collectStandaloneWasm({bytes,relPath:'cpu.wasm',repositoryNamespace:root,stagingRoot,storage:cpu.semanticFactsRef.storage,diskAccount:state.semanticDiskAccount,policy});
  const off = await collectPolicy(offPolicy);
  assert.equal(off.semanticFactsRef.syntaxPartitionId,cpu.semanticFactsRef.syntaxPartitionId);
  assert.ok(off.semanticFactsRef.coverage.some(row=>row.phase==='localFlow'&&row.state==='disabled'));
  assert.equal(off.semanticFactsRef.counts.semantic_edges,0);
  const deferred = await collectPolicy({...policy,enrichment:{...policy.enrichment,localFlow:'deferred'}});
  assert.ok(deferred.semanticFactsRef.coverage.some(row=>row.reason==='wasm_deferred_flow_requires_task'&&row.state==='deferred'));
  const selectedPolicy={...policy,targets:[{sourceUnitId:cpu.semanticFactsRef.sourceUnitId,sourceHash:cpu.semanticFactsRef.sourceHash,ref:{partitionId:cpu.semanticFactsRef.syntaxPartitionId,localId:0}}]};
  const targeted=await collectPolicy(selectedPolicy);
  assert.ok(targeted.semanticFactsRef.coverage.some(row=>row.reason?.includes('wasm_module_target_widens_to_whole_module')));
  assert.ok(targeted.semanticFactsRef.counts.semantic_edges>0);
  const targetStore=storeFor(targeted.semanticFactsRef.partitions);
  for await(const source of targetStore.iterateRows(targeted.semanticFactsRef.syntaxPartitionId,'semantic_sources')) {
    const resolved=resolveSemanticSourcePolicy(selectedPolicy,{sourceUnitId:source.sourceUnitId,sourceHash:source.byteHash,path:source.path,language:'wasm'});
    await validateSemanticSourceTargets(resolved,{source,partitionId:targeted.semanticFactsRef.syntaxPartitionId,store:targetStore});
    await assert.rejects(validateSemanticSourceTargets({...resolved,targets:[{range:{start:0,end:1}}]},{source,partitionId:targeted.semanticFactsRef.syntaxPartitionId,store:targetStore}),/exceeds/,'text ranges cannot masquerade as binary byte selections');
  }
  await fs.writeFile(path.join(root,'processor.wasm'),bytes);
  const processor=createFileProcessorForTest({root,overrides:{
    semantic:{policy,stagingRoot,buildRoot:root,repositoryNamespace:root,storage:{generation:{baseBuildId:'processor',semanticRevision:0},relativePath:'semantic'},diskAccount:state.semanticDiskAccount},
    incrementalState:{enabled:false,manifest:{files:{},dependencySignatures:{parse:'a'.repeat(64)}},bundleDir:'',bundleFormat:'json'}
  }});
  const processed=await processor.processFile(createScannedFileEntry({abs:path.join(root,'processor.wasm'),rel:'processor.wasm',stat:await fs.stat(path.join(root,'processor.wasm')),scan:{skipReason:'binary'}}),0);
  assert.ok(processed?.semanticFactsRef,'full file processor admits semantic binary files before text/binary skips');
  const partitions = await collectCompilerBoundaryFlow({ group, state, policy }), store = storeFor([...syntaxPartitions, ...partitions]);
  const rows = new Map(), edges = [], coverage = [];
  const key = ref => ref.partitionId + ':' + ref.localId;
  for (const p of [...syntaxPartitions, ...partitions]) {
    for await (const row of store.iterateRows(p.partitionId,'semantic_records')) rows.set(p.partitionId+':'+row.id,row);
    for await (const row of store.iterateRows(p.partitionId,'semantic_edges')) edges.push(row);
    for await (const row of store.iterateRows(p.partitionId,'semantic_coverage')) coverage.push(row);
  }
  const links = edges.filter(edge => edge.kind==='callTarget' && rows.get(key(edge.from))?.data.boundaryKind==='wasm-export-entry-request');
  assert.equal(links.length, 7, JSON.stringify({links:links.map(edge=>rows.get(key(edge.from)).span),coverage:coverage.map(row=>row.reason)}));
  assert.equal(links.filter(edge=>edge.certainty==='exact-static').length,3);
  assert.ok(edges.some(edge=>edge.kind==='evidenceInput' && key(edge.from)===key(retained.moduleRef)));
  assert.ok(coverage.some(row=>row.reason?.includes('wasm_local_binary_not_in_retained_inventory')));
  await assert.rejects(async () => {
    const sourceFile = path.join(stagingRoot,'semantic-sources',retained.source.byteHash+'.utf8');
    await fs.writeFile(sourceFile,Buffer.alloc(bytes.length)); await retained.readBytes();
  }, /hash or length mismatch/);
  console.log('standalone binary admission and retained streaming/filesystem byte provenance passed');
} finally { await fs.rm(root,{recursive:true,force:true}); }
