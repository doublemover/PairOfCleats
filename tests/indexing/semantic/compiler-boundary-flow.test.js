import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { createTypeScriptNodeIndex } from '../../../src/index/tooling/typescript/node-index.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
// Code-first acceptance fixture: added but intentionally not executed in this span.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-boundaries-'));
const texts = {
  'input.ts': 'import { fork, spawn } from "node:child_process"; const payload = 42; Promise.resolve(payload).then(value => console.log(value)); queueMicrotask(() => console.log(payload)); setTimeout(value => console.log(value), 10, payload); const child = fork(new URL("./child.ts", import.meta.url)); child.send(payload); spawn("unknown-command", ["--x"]); process.dlopen({exports:{}} as any, "./addon.node"); const memory = new WebAssembly.Memory({initial:1,shared:true,maximum:2}); const view = memory.buffer; declare const bytes: Uint8Array; WebAssembly.instantiate(bytes, {env:{host:(x:number)=>x+1}}); declare const instance: WebAssembly.Instance; instance.exports["entry"](payload);',
  'child.ts': 'export {}; process.on("message", value => { console.log(value); });',
  'dynamic.ts': 'import {fork} from "node:child_process"; declare const entry: string; const child = fork(entry); child.send(1); declare const handler: () => void; queueMicrotask(handler);',
  'fake.ts': 'export {}; class Promise { static resolve(x:any){return new Promise()} then(callback:any){} } function queueMicrotask(callback:any){} function setTimeout(callback:any, ...args:any[]){} const child={send(x:any){}}; const WebAssembly={instantiate(x:any,y:any){}, Memory:class{buffer:any}}; Promise.resolve(1).then((x:any)=>x); queueMicrotask(()=>1); setTimeout(()=>1,1); child.send(1); WebAssembly.instantiate(1,{}); new WebAssembly.Memory();'
};
try {
  for (const [file, text] of Object.entries(texts)) await fs.writeFile(path.join(root, file), text);
  const { ts } = prepareTypeScriptSyntax('', { ext: '.ts' });
  const options = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: ['node'], typeRoots: [path.resolve('node_modules/@types')], skipLibCheck: true };
  const program = ts.createProgram(Object.keys(texts).map(file => path.join(root, file)), options), checker = program.getTypeChecker();
  const policy = normalizeSemanticConfig({ enabled: true, enrichment: { bindings: 'eager', localFlow: 'eager', crossFileFlow: 'eager' } });
  const account = createSemanticDiskAccount(64 * 1024 * 1024), generation = { baseBuildId: 'boundary-fixture', semanticRevision: 0 }, stagingRoot = path.join(root, 'semantic');
  const state = { semanticDiskAccount: account, semanticFactsByFile: new Map() }, documents = [], syntaxPartitions = [];
  for (const [file, text] of Object.entries(texts)) {
    const sourceFile = program.getSourceFile(path.join(root, file)); prepareTypeScriptSyntax(text, { ts, sourceFile, ext: '.ts' });
    const bytes = Buffer.from(text), facts = await collectFileSemanticFacts({ bytes, text, ast: sourceFile, ts, language: 'typescript', relPath: file, repositoryNamespace: root, stagingRoot, diskAccount: account, policy });
    const store = createArtifactSemanticStore({ root: stagingRoot, repoRoot: root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions: [facts.partition] });
    const expressions = new Map(), declarations = new Map();
    for await (const row of store.iterateRows(facts.partition.partitionId, 'semantic_records')) if (row.span) {
      const ref = { partitionId: facts.partition.partitionId, localId: row.id };
      if (row.kind === 'expression') expressions.set(row.span.join(':'), ref);
      if (row.kind === 'declaration') declarations.set(row.span.join(':'), ref);
    }
    const expressionFor = node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) || null : null;
    const nodes = [...createTypeScriptNodeIndex(ts, sourceFile, () => null).nodes()];
    const observations = nodes.filter(node => ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isIdentifier(node)).map(node => ({ node, invocation: ts.isCallExpression(node) || ts.isNewExpression(node), signatureDeclaration: ts.isCallExpression(node) || ts.isNewExpression(node) ? checker.getResolvedSignature(node)?.declaration : null }));
    const descriptor = createSemanticFactsRef({ source: facts.source, syntaxPartitionId: facts.partition.partitionId, partitions: [facts.partition], storage: { generation, relativePath: 'semantic' }, coverage: facts.coverage });
    state.semanticFactsByFile.set(file, descriptor); syntaxPartitions.push(facts.partition);
    documents.push({ ts, checker, sourceFile, nodes, expressionFor, observations, bytes, bindingPartition: facts.partition, policy, item: { file, source: facts.source, root: stagingRoot, declarations }, containerPath: file });
  }
  const group = { workerDocuments: documents, repoRoot: root, context: { contextKey: 'a'.repeat(64), compilerVersion: ts.version }, dependencyHashes: [], isDefaultLibrary: file => program.isSourceFileDefaultLibrary(file) };
  const partitions = await collectCompilerBoundaryFlow({ group, state, policy });
  const store = createArtifactSemanticStore({ root: stagingRoot, repoRoot: root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions: [...syntaxPartitions, ...partitions] });
  const records = new Map(), edges = [], coverage = [];
  for (const partition of [...syntaxPartitions, ...partitions]) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(partition.partitionId + ':' + row.id, { row, partition });
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    if (partitions.includes(partition)) for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  const kinds = [...records.values()].filter(value => value.row.kind === 'boundary').map(value => value.row.data.boundaryKind);
  for (const kind of ['promise-then-continuation-request', 'promise-then-source-callback-candidate', 'queueMicrotask-callback-request', 'child-process-fork-launch-request', 'process-ipc-dispatch-request', 'process-ipc-consumer-source-callback-candidate', 'native-addon-entry-request', 'wasm-entry-request', 'wasm-host-import-source-callback-candidate', 'wasm-export-entry-request', 'wasm-memory-buffer-storage-candidate']) assert.ok(kinds.includes(kind), kind);
  const fake = documents.find(doc => doc.item.file === 'fake.ts').item.source.sourceUnitId;
  assert.ok(partitions.every(partition => partition.sourceUnitId !== fake), 'same-spelling user APIs never acquire platform authority');
  const child = documents.find(doc => doc.item.file === 'child.ts').item.source.sourceUnitId;
  assert.ok(edges.some(edge => edge.kind === 'consumes' && records.get(edge.to.partitionId + ':' + edge.to.localId)?.partition.sourceUnitId === child), 'IPC payload consumption preserves exact child source ref');
  assert.ok(edges.every(edge => edge.certainty === 'modeled' && !['copies', 'transfers'].includes(edge.kind)), 'no IPC copy/transfer or runtime execution proof');
  assert.ok(coverage.every(row => row.state === 'partial'));
  assert.ok(coverage.some(row => row.reason.includes('process_executable_cwd_environment_or_entry_dynamic')));
  const hashes = partitions.map(partition => partition.canonicalHash).sort();
  const repeated = await collectCompilerBoundaryFlow({ group: { ...group, workerDocuments: [...documents].reverse() }, state, policy });
  assert.deepEqual(repeated.map(partition => partition.canonicalHash).sort(), hashes, 'scheduling preserves logical facts');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectCompilerBoundaryFlow({ group, state, policy, signal: controller.signal }), error => error.name === 'AbortError' || error.code === 'ABORT_ERR');
  console.log('compiler boundary authority and source candidates passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
