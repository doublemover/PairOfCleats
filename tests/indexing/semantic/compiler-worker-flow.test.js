import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { collectCompilerWorkerFlow } from '../../../src/index/semantic/compiler-worker-flow.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { createTypeScriptNodeIndex } from '../../../src/index/tooling/typescript/node-index.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(),'poc-worker-source-'));
const texts = {
  'input.ts': 'export {}; const worker = new Worker(new URL("./worker.ts", import.meta.url), {type:"module"}); const alias = worker; const buffer = new ArrayBuffer(8); const shared = new SharedArrayBuffer(8); const payload = {buffer, shared, label:"hé😀"}; alias.postMessage(payload, [buffer, shared]); worker.postMessage(shared); worker.postMessage(buffer, [buffer]); worker.onmessage = event => consume(event.data); worker.addEventListener("message", event => consumeAgain(event.data));',
  'worker.ts': 'export {}; declare const self: DedicatedWorkerGlobalScope; self.addEventListener("message", event => { const data = event.data; console.log(data); self.postMessage(data); });',
  'ports.ts': 'export {}; const channel = new MessageChannel(); const port = channel.port1; channel.port2.onmessage = event => accept(event.data); channel.port2.addEventListener("message", event => acceptAgain(event.data)); port.onmessage = event => respond(event.data); port.postMessage(1); channel.port2.postMessage(2); const other = new MessageChannel(); other.port1.postMessage(3);',
  'dynamic.ts': 'export {}; declare const entry: string; const worker = new Worker(new URL(entry, import.meta.url)); worker.postMessage({value:1});',
  'fake.ts': 'export {}; class Worker { constructor(url: any) {} postMessage(value:any) {} } const worker = new Worker(new URL("./worker.ts",import.meta.url)); worker.postMessage({value:1});',
  'fake-url.ts': 'export {}; class URL { constructor(path:string,base:string) {} } const worker = new Worker(new URL("./worker.ts",import.meta.url) as any); worker.postMessage(1);',
  'window.ts': 'export {}; window.addEventListener("message", event => console.log(event.data));',
  'window-input.ts': 'export {}; const worker = new Worker(new URL("./window.ts",import.meta.url)); worker.postMessage(1);'
};
try {
  for(const [file,text] of Object.entries(texts)) await fs.writeFile(path.join(root,file),text);
  const {ts} = prepareTypeScriptSyntax('',{ext:'.ts'});
  const options = { module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.webworker.d.ts'],skipLibCheck:true };
  const program = ts.createProgram(Object.keys(texts).map(file=>path.join(root,file)),options), checker = program.getTypeChecker();
  const policy = normalizeSemanticConfig({enabled:true,profile:'rich',enrichment:{crossFileFlow:'eager'}}), account = createSemanticDiskAccount(32*1024*1024), generation = {baseBuildId:'worker-fixture',semanticRevision:0}, stagingRoot = path.join(root,'semantic');
  const state = {semanticDiskAccount:account,semanticFactsByFile:new Map()}, documents = [], syntaxPartitions = [];
  for(const [file,text] of Object.entries(texts)) {
    const sourceFile = program.getSourceFile(path.join(root,file)); prepareTypeScriptSyntax(text,{ts,sourceFile,ext:'.ts'});
    const bytes = Buffer.from(text), facts = await collectFileSemanticFacts({bytes,text,ast:sourceFile,ts,language:'typescript',relPath:file,repositoryNamespace:root,stagingRoot,diskAccount:account,policy});
    const store = createArtifactSemanticStore({root:stagingRoot,repoRoot:root,artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,generation,partitions:[facts.partition]});
    const expressions = new Map();for await(const row of store.iterateRows(facts.partition.partitionId,'semantic_records')) if(row.kind==='expression' && row.span) expressions.set(row.span.join(':'),{partitionId:facts.partition.partitionId,localId:row.id});
    const expressionFor = node=>node ? expressions.get(node.getStart(sourceFile)+':'+node.end)||null:null;
    const nodes = [...createTypeScriptNodeIndex(ts,sourceFile,()=>null).nodes()], observations = nodes.filter(node=>(ts.isCallExpression(node)||ts.isNewExpression(node)) && expressionFor(node)).map(node=>({invocation:true,node,signatureDeclaration:checker.getResolvedSignature(node)?.declaration}));
    const descriptor = createSemanticFactsRef({source:facts.source,syntaxPartitionId:facts.partition.partitionId,partitions:[facts.partition],storage:{generation,relativePath:'semantic'},coverage:facts.coverage});state.semanticFactsByFile.set(file,descriptor);syntaxPartitions.push(facts.partition);
    documents.push({ts,checker,sourceFile,nodes,expressionFor,observations,bytes,bindingPartition:facts.partition,item:{file,source:facts.source,root:stagingRoot},containerPath:file});
  }
  const group = {workerDocuments:documents,repoRoot:root,context:{contextKey:'a'.repeat(64)},dependencyHashes:[],isDefaultLibrary:source=>program.isSourceFileDefaultLibrary(source)};
  const partitions = await collectCompilerWorkerFlow({group,state,policy});
  const store = createArtifactSemanticStore({root:stagingRoot,repoRoot:root,artifactSurfaceVersion:ARTIFACT_SURFACE_VERSION,generation,partitions:[...syntaxPartitions,...partitions]});
  const records = new Map(),edges=[],coverage=[];for(const partition of [...syntaxPartitions,...partitions]) {
    for await(const row of store.iterateRows(partition.partitionId,'semantic_records'))records.set(partition.partitionId+':'+row.id,{row,partition});
    for await(const row of store.iterateRows(partition.partitionId,'semantic_edges'))edges.push(row);
    if(partitions.includes(partition))for await(const row of store.iterateRows(partition.partitionId,'semantic_coverage'))coverage.push(row);
  }
  const kind = ref=>records.get(ref.partitionId+':'+ref.localId)?.row.data.boundaryKind;
  const receives = [...records.values()].filter(value=>value.row.data.boundaryKind==='worker-source-message-consumer-candidate'); assert.equal(receives.length,3);
  assert.equal(receives[0].partition.sourceUnitId,documents.find(doc=>doc.item.file==='worker.ts').item.source.sourceUnitId);
  assert.ok(receives.every(value => value.row.data.fromContext === 'source:' + documents.find(doc => doc.item.file === 'input.ts').item.source.sourceUnitId
    && value.row.data.toContext === 'source:' + documents.find(doc => doc.item.file === 'worker.ts').item.source.sourceUnitId), 'consumer boundary preserves sender-to-receiver realm direction');
  const incoming = edges.find(edge=>edge.kind==='dispatches' && kind(edge.to)==='worker-source-message-consumer-candidate'); assert.ok(incoming); assert.equal(kind(incoming.from),'worker-message-dispatch-request');
  const consume = edges.find(edge=>edge.kind==='consumes' && kind(edge.from)==='worker-source-message-consumer-candidate');assert.ok(consume);const target=records.get(consume.to.partitionId+':'+consume.to.localId).row;assert.equal(texts['worker.ts'].slice(...target.span),'event.data');
  assert.ok(edges.some(edge=>edge.kind==='packs' && kind(edge.to)==='worker-structured-clone-request'));
  const portDispatches = [...records.values()].filter(value => value.row.data.boundaryKind === 'message-port-dispatch-request');
  assert.equal(portDispatches.length, 3);
  const portConsumers = [...records.values()].filter(value => value.row.data.boundaryKind === 'message-port-consumer-candidate');
  assert.equal(portConsumers.length, 3, 'two peer registrations and one reverse response candidate');
  const portEdges = edges.filter(edge => edge.kind === 'dispatches' && kind(edge.to) === 'message-port-consumer-candidate');
  assert.equal(portEdges.length, 3, 'different channel constructor cannot cross into these consumers');
  assert.ok(portEdges.every(edge => kind(edge.from) === 'message-port-dispatch-request'));
  assert.ok(coverage.some(row => row.reason.includes('message_port_start_close_transfer_instance_and_delivery_unobserved')));

  assert.equal(edges.filter(edge=>edge.kind==='transfers' && kind(edge.to)==='worker-transfer-request').length,2);
  assert.ok(edges.some(edge=>edge.kind==='sharesStorage' && kind(edge.to)==='worker-shared-storage-request'));
  assert.ok(edges.every(edge=>edge.certainty==='modeled')); assert.ok(edges.every(edge=>edge.kind!=='copies'),'serialization request does not prove storage copy, including direct shared/transfer payloads'); assert.ok(coverage.some(row=>row.reason.includes('shared_buffer_not_transferable')));
  const responses = [...records.values()].filter(value => value.row.data.boundaryKind === 'worker-source-response-consumer-candidate');
  assert.equal(responses.length, 2, 'both main-thread registrations retain response candidates');
  assert.ok(edges.some(edge => edge.kind === 'dispatches' && kind(edge.from) === 'worker-response-dispatch-request' && kind(edge.to) === 'worker-source-response-consumer-candidate'));
  assert.ok(coverage.some(row => row.reason.includes('response_correlation_instance_and_runtime_delivery_unobserved')));
  const fakeSource=documents.find(doc=>doc.item.file==='fake.ts').item.source.sourceUnitId;assert.ok(partitions.every(partition=>partition.sourceUnitId!==fakeSource),'fake Worker methods have no platform authority');
  for(const file of ['dynamic.ts','fake-url.ts','window-input.ts']) { const id=documents.find(doc=>doc.item.file===file).item.source.sourceUnitId; const own=coverage.filter(row=>row.scope.sourceUnitId===id && row.phase==='boundaryModels');assert.equal(own.length,1);assert.equal(own[0].state,'partial');assert.match(own[0].reason,/dynamic_or_not_in_exact_inventory|consumer_unavailable/); }
  assert.ok(coverage.filter(row=>row.phase==='boundaryModels').every(row=>row.state==='partial'));
  const hashes=partitions.map(row=>row.canonicalHash).sort();const repeated=await collectCompilerWorkerFlow({group:{...group,workerDocuments:[...documents].reverse()},state,policy});assert.deepEqual(repeated.map(row=>row.canonicalHash).sort(),hashes,'document scheduling cannot change logical IDs');
  const off = await collectCompilerWorkerFlow({group,state,policy:normalizeSemanticConfig({enabled:true,enrichment:{crossFileFlow:'off'}})});assert.deepEqual(off,[]);
  const controller=new AbortController();controller.abort();await assert.rejects(collectCompilerWorkerFlow({group,state,policy,signal:controller.signal}),error=>error.name==='AbortError'||error.code==='ABORT_ERR');
  console.log('literal Worker entry, message consumer, clone/transfer/shared requests and authority counterexamples passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
