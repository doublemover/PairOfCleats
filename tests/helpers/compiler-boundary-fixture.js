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
export const createCompilerBoundaryFixture = async (root, texts) => {
  for (const [file, text] of Object.entries(texts)) await fs.writeFile(path.join(root, file), text);
  const { ts } = prepareTypeScriptSyntax('', { ext: '.ts' });
  const program = ts.createProgram(Object.keys(texts).map(file => path.join(root, file)), {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], skipLibCheck: true
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
  return { state, policy, documents, syntaxPartitions, stagingRoot, storeFor,
    group: { workerDocuments: documents, repoRoot: root, context: { contextKey: 'a'.repeat(64), compilerVersion: ts.version }, dependencyHashes: [], isDefaultLibrary: file => program.isSourceFileDefaultLibrary(file) } };
};
