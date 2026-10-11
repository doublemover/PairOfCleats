import { collectCompilerFlow } from '../../src/index/semantic/compiler-flow.js';
import { collectStandaloneWasm } from '../../src/index/semantic/wasm/standalone.js';
import { retainedWasmSource } from '../../src/index/semantic/wasm/retained-source.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectFileSemanticFacts } from '../../src/index/semantic/collect-file.js';
import { createSemanticFactsRef } from '../../src/index/semantic/file-ref.js';
import { normalizeSemanticConfig } from '../../src/index/semantic/config.js';
import { prepareTypeScriptSyntax } from '../../src/lang/typescript/syntax-context.js';
import { createTypeScriptNodeIndex } from '../../src/index/tooling/typescript/node-index.js';
import { createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
export const createCompilerBoundaryFixture = async (root, texts, binaries = {}, { withFlow = false } = {}) => {
  for (const [file, text] of Object.entries(texts)) await fs.writeFile(path.join(root, file), text);
  const { ts } = prepareTypeScriptSyntax('', { ext: '.ts' });
  const program = ts.createProgram(Object.keys(texts).map(file => path.join(root, file)), {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: ['node'], typeRoots: [path.resolve('node_modules/@types')], skipLibCheck: true
    }), checker = program.getTypeChecker();
  const policy = normalizeSemanticConfig({ enabled: true, enrichment: { bindings: 'eager', localFlow: 'eager', crossFileFlow: 'eager' } });
  const account = createSemanticDiskAccount(64 * 1024 * 1024), generation = { baseBuildId: 'wasm-fixture', semanticRevision: 0 }, stagingRoot = path.join(root, 'semantic');
  const state = { semanticDiskAccount: account, semanticFactsByFile: new Map() }, documents = [], syntaxPartitions = [];
  const storeFor = partitions => createArtifactSemanticStore({ root: stagingRoot, repoRoot: root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions });
  for (const [file, text] of Object.entries(texts)) {
    const sourceFile = program.getSourceFile(path.join(root, file)); prepareTypeScriptSyntax(text, { ts, sourceFile, ext: '.ts' });
    const bytes = Buffer.from(text), facts = await collectFileSemanticFacts({ bytes, text, ast: sourceFile, ts, language: 'typescript', relPath: file, repositoryNamespace: root, stagingRoot, diskAccount: account, policy });
    const expressions = new Map(), declarations = new Map();
    for await (const row of storeFor([facts.partition]).iterateRows(facts.partition.partitionId, 'semantic_records')) if (row.span) {
      const ref = { partitionId: facts.partition.partitionId, localId: row.id };
      if (row.kind === 'expression') expressions.set(row.span.join(':'), ref);
      if (row.kind === 'declaration') declarations.set(row.span.join(':'), ref);
    }
    const expressionFor = node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) || null : null;
    const nodes = [...createTypeScriptNodeIndex(ts, sourceFile, () => null).nodes()];
    const observations = nodes.filter(node => ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isIdentifier(node)).map(node => ({ node,
      invocation: ts.isCallExpression(node) || ts.isNewExpression(node), signatureDeclaration: ts.isCallExpression(node) || ts.isNewExpression(node) ? checker.getResolvedSignature(node)?.declaration : null }));
    state.semanticFactsByFile.set(file, createSemanticFactsRef({ source: facts.source, syntaxPartitionId: facts.partition.partitionId, partitions: [facts.partition], storage: { generation, relativePath: 'semantic' }, coverage: facts.coverage }));
    syntaxPartitions.push(facts.partition);
    documents.push({ ts, checker, sourceFile, nodes, expressionFor, observations, bytes, bindingPartition: facts.partition, policy, item: { file, source: facts.source, root: stagingRoot, declarations }, containerPath: file });
  }
  const wasmModules = new Map();
  for (const [file, bytes] of Object.entries(binaries)) {
    const result = await collectStandaloneWasm({ bytes, relPath: file, repositoryNamespace: root, stagingRoot, storage: { generation, relativePath: 'semantic' }, diskAccount: account, policy });
    const facts = result.semanticFactsRef, store = storeFor(facts.partitions);
    state.semanticFactsByFile.set(file, facts); syntaxPartitions.push(...facts.partitions);
    state.semanticEvidenceArtifacts ||= []; state.semanticEvidenceArtifacts.push(...result.semanticEvidenceArtifacts);
    for await (const source of store.iterateRows(facts.syntaxPartitionId, 'semantic_sources')) {
      const key = path.resolve(root, file); wasmModules.set(process.platform === 'win32' ? key.toLowerCase() : key, retainedWasmSource({ source, root: stagingRoot, store, syntaxPartitionId: facts.syntaxPartitionId }));
    }
  }
  const flowDocuments = [];
  if (withFlow) for(const doc of documents) {
    const flow=await collectCompilerFlow({...doc, source:doc.item.source, root:stagingRoot, diskAccount:account, context:{contextKey:'a'.repeat(64)},
      declarationFor:node=> {const anchor=node?.name||node;return anchor?doc.item.declarations.get(anchor.getStart(doc.sourceFile)+':'+anchor.end):null;} });
    flowDocuments.push({...doc,partition:flow.partition,policy,summaries:flow.summaries,flowEdges:flow.edges,aliases:flow.aliases,fieldAccesses:flow.fieldAccesses,callEffects:flow.callEffects,calls:[]});syntaxPartitions.push(flow.partition);
    const current=state.semanticFactsByFile.get(doc.item.file);
    state.semanticFactsByFile.set(doc.item.file,createSemanticFactsRef({source:doc.item.source,syntaxPartitionId:current.syntaxPartitionId,storage:current.storage,partitions:[...current.partitions,flow.partition],coverage:[...current.coverage,...flow.coverage]}));
  }
  return { state, policy, documents, syntaxPartitions, stagingRoot, storeFor,
    group: { flowDocuments, wasmModules, workerDocuments: documents, repoRoot: root, context: { contextKey: 'a'.repeat(64), compilerVersion: ts.version }, dependencyHashes: [], isDefaultLibrary: file => program.isSourceFileDefaultLibrary(file) } };
};
