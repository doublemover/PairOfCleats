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
  'input.ts': `export {};
    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    const channel = new MessageChannel(); const other = new MessageChannel();
    const buffer = new ArrayBuffer(4);
    channel.port1.onmessage = (event: MessageEvent) => accept(event.data);
    other.port1.onmessage = (event: MessageEvent) => wrong(event.data);
    worker.postMessage({nested: [{port: channel.port2}]}, {transfer: [buffer, channel.port2]});
    channel.port1.postMessage("to-transferred-receiver");
    worker.onmessage = (event: MessageEvent) => { const reply = event.ports[0]; reply.postMessage("response-port"); };
    const missing = new Worker(new URL("./missing.ts", import.meta.url));
    missing.postMessage({port: other.port2});
    const dynamic = new Worker(new URL("./dynamic.ts", import.meta.url));
    declare const transfers: Transferable[]; dynamic.postMessage({port: other.port2}, transfers);
    const budget = new Worker(new URL("./budget.ts", import.meta.url)); budget.postMessage({}, [${Array(33).fill('other.port2').join(',')}]);
    const duplicate = new Worker(new URL("./duplicate.ts", import.meta.url));
    duplicate.postMessage({port: other.port2}, [other.port2, other.port2]);
    const unknown = new Worker(new URL("./unknown.ts", import.meta.url));
    declare const uncertain: Transferable; unknown.postMessage({}, [uncertain, other.port2]);`,
  'worker.ts': `export {}; declare const self: DedicatedWorkerGlobalScope;
    self.onmessage = (event: MessageEvent) => {
      const port = event.ports[0]; port.postMessage("indexed-port"); port.onmessage = event => typedBySource(event.data);
      const payloadPort = event.data.nested[0].port; payloadPort.postMessage("payload-port");
      const relay = new MessageChannel();
      relay.port1.onmessage = (event: MessageEvent) => relaySink(event.data);
      port.postMessage({next: relay.port2}, [relay.port2]);
      const response = new MessageChannel();
      response.port1.onmessage = (event: MessageEvent) => responseSink(event.data);
      self.postMessage({}, [response.port2]);
    };`,
  'missing.ts': `export {}; declare const self: DedicatedWorkerGlobalScope; self.onmessage = (event: MessageEvent) => { event.data.port.postMessage("missing"); event.ports[0].postMessage("missing-index"); };`,
  'dynamic.ts': `export {}; declare const self: DedicatedWorkerGlobalScope; self.onmessage = (event: MessageEvent) => { event.data.port.postMessage("dynamic"); };`,
  'duplicate.ts': `export {}; declare const self: DedicatedWorkerGlobalScope; self.onmessage = (event: MessageEvent) => { event.ports[0].postMessage("duplicate"); };`,
  'budget.ts': `export {}; declare const self: DedicatedWorkerGlobalScope; self.onmessage = (event: MessageEvent) => { event.ports[0].postMessage("budget"); };`,
  'unknown.ts': `export {}; declare const self: DedicatedWorkerGlobalScope; self.onmessage = (event: MessageEvent) => { event.ports[0].postMessage("unknown-index"); };`,
  'fake.ts': `export {}; class MessageChannel { port1: any; port2: any; } const channel = new MessageChannel(); channel.port1.postMessage(1);`
};
// A transferred port can forward another port, establishing identity in a later round.
texts['input.ts'] += ` channel.port1.addEventListener("message", (event: MessageEvent) => { event.data.next.postMessage("relayed-port"); });`;

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
  const sourceText = ref => { const value = records.get(ref.partitionId+':'+ref.localId); const doc = documents.find(doc => doc.item.source.sourceUnitId === value?.partition.sourceUnitId); return value?.row.span && doc ? texts[doc.item.file].slice(...value.row.span) : ''; };
  const dispatches = edges.filter(edge => edge.kind === 'dispatches' && kind(edge.to) === 'message-port-consumer-candidate');
  const matched = dispatches.map(edge => sourceText(edge.callSite));
  for (const label of ['indexed-port', 'payload-port', 'response-port', 'relayed-port', 'to-transferred-receiver']) assert.ok(matched.some(text => text.includes('"'+label+'"')), label + ' reaches source-backed opposite endpoint');
  for (const label of ['missing', 'missing-index', 'dynamic', 'duplicate', 'unknown-index', 'budget']) assert.ok(!matched.some(text => text.includes('"'+label+'"')), label + ' must not establish port identity');
  assert.ok(![...records.values()].some(value => value.row.data.boundaryKind === 'message-port-consumer-candidate' && value.row.span && texts['input.ts'].slice(...value.row.span).includes('wrong(event.data)')), 'unrelated channel does not receive transferred-port messages');
  assert.ok(edges.some(edge => edge.kind === 'transfers' && kind(edge.to) === 'browser-transferred-port-candidate'));
  assert.ok(coverage.some(row => row.reason.includes('browser_port_transfer_list_dynamic_or_budget')));
  assert.ok(coverage.some(row => row.reason.includes('browser_port_duplicate_transfer_unresolved')));
  assert.ok(coverage.some(row => row.reason.includes('browser_port_transfer_order_unresolved')));
  assert.ok(edges.every(edge => edge.certainty === 'modeled'));
  assert.ok(coverage.every(row => row.state === 'partial'));
  const hashes=partitions.map(row=>row.canonicalHash).sort();const repeated=await collectCompilerWorkerFlow({group:{...group,workerDocuments:[...documents].reverse()},state,policy});assert.deepEqual(repeated.map(row=>row.canonicalHash).sort(),hashes,'document scheduling cannot change logical IDs');
  const off = await collectCompilerWorkerFlow({group,state,policy:normalizeSemanticConfig({enabled:true,enrichment:{crossFileFlow:'off'}})});assert.deepEqual(off,[]);
  const controller=new AbortController();controller.abort();await assert.rejects(collectCompilerWorkerFlow({group,state,policy,signal:controller.signal}),error=>error.name==='AbortError'||error.code==='ABORT_ERR');
  console.log('browser transferred ports, payload paths, response and relay candidates passed');
} finally {await fs.rm(root,{recursive:true,force:true});}
