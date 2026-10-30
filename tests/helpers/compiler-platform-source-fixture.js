import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from './temp.js';
import { collectFileSemanticFacts } from '../../src/index/semantic/collect-file.js';
import { createSemanticFactsRef } from '../../src/index/semantic/file-ref.js';
import { normalizeSemanticConfig } from '../../src/index/semantic/config.js';
import { prepareTypeScriptSyntax } from '../../src/lang/typescript/syntax-context.js';
import { createTypeScriptNodeIndex } from '../../src/index/tooling/typescript/node-index.js';
import { createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { createArtifactSemanticStore } from '../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';

/** Real compiler authority and stored syntax with no process/worker execution. */
export const createCompilerPlatformSourceFixture = async texts => {
  const root = await makeTempDir('compiler-platform-source-');
  try {
    for (const [file, text] of Object.entries(texts)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), text);
    }
    const { ts } = prepareTypeScriptSyntax('', { ext: '.ts' });
    const program = ts.createProgram(Object.keys(texts).map(file => path.join(root, file)), {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.webworker.d.ts'],
      types: ['node'], typeRoots: [path.resolve('node_modules/@types')], skipLibCheck: true
    });
    const checker = program.getTypeChecker(), stagingRoot = path.join(root, 'semantic');
    const policy = normalizeSemanticConfig({ enabled: true, profile: 'rich',
      enrichment: { bindings: 'eager', localFlow: 'eager', crossFileFlow: 'eager' } });
    const account = createSemanticDiskAccount(64 * 1024 * 1024), generation = { baseBuildId: 'source-url-fixture', semanticRevision: 0 };
    const state = { semanticDiskAccount: account, semanticFactsByFile: new Map() }, documents = [], syntax = [];
    const storeFor = partitions => createArtifactSemanticStore({ root: stagingRoot, repoRoot: root,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions });
    for (const [file, text] of Object.entries(texts)) {
      const sourceFile = program.getSourceFile(path.join(root, file)); prepareTypeScriptSyntax(text, { ts, sourceFile, ext: '.ts' });
      const bytes = Buffer.from(text), facts = await collectFileSemanticFacts({ bytes, text, ast: sourceFile, ts,
        language: 'typescript', relPath: file, repositoryNamespace: root, stagingRoot, diskAccount: account, policy });
      const expressions = new Map(), declarations = new Map();
      for await (const row of storeFor([facts.partition]).iterateRows(facts.partition.partitionId, 'semantic_records')) {
        if (!row.span) continue;
        const ref = { partitionId: facts.partition.partitionId, localId: row.id };
        if (row.kind === 'expression') expressions.set(row.span.join(':'), ref);
        if (row.kind === 'declaration') declarations.set(row.span.join(':'), ref);
      }
      const expressionFor = node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) || null : null;
      const nodes = [...createTypeScriptNodeIndex(ts, sourceFile, () => null).nodes()];
      const observations = nodes.filter(node => ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isIdentifier(node))
        .map(node => ({ node, invocation: ts.isCallExpression(node) || ts.isNewExpression(node),
          signatureDeclaration: ts.isCallExpression(node) || ts.isNewExpression(node) ? checker.getResolvedSignature(node)?.declaration : null }));
      state.semanticFactsByFile.set(file, createSemanticFactsRef({ source: facts.source, syntaxPartitionId: facts.partition.partitionId,
        partitions: [facts.partition], storage: { generation, relativePath: 'semantic' }, coverage: facts.coverage }));
      syntax.push(facts.partition);
      documents.push({ ts, checker, sourceFile, nodes, observations, expressionFor, bytes, bindingPartition: facts.partition,
        policy, item: { file, source: facts.source, root: stagingRoot, declarations }, containerPath: file });
    }
    const group = { workerDocuments: documents, repoRoot: root, context: { contextKey: 'a'.repeat(64), compilerVersion: ts.version },
      dependencyHashes: [], isDefaultLibrary: file => program.isSourceFileDefaultLibrary(file) };
    const read = async partitions => {
      const all = [...syntax, ...partitions], store = storeFor(all), records = new Map(), edges = [], coverage = [];
      for (const partition of all) {
        for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(`${partition.partitionId}:${row.id}`, { row, partition });
        for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
        if (partitions.includes(partition)) for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
      }
      return { records, edges, coverage };
    };
    return { root, group, state, policy, documents, read, cleanup: () => rmDirRecursive(root) };
  } catch (error) { await rmDirRecursive(root); throw error; }
};
