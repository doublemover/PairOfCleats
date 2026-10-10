import path from 'node:path';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { createSemanticFactsRef } from './file-ref.js';
/** Merge validated source-pinned provider parts without replacing immutable syntax. */
export const mergeSemanticProviderOutput = async ({ output, state, runtime, signal }) => {
  assertSemanticEnvelope('provider', output);
  const contexts = new Map((state.semanticCompilerContexts || []).map(context => [context.contextKey, context]));
  for (const context of output.contexts) contexts.set(context.contextKey, context);
  for (const [file, current] of state.semanticFactsByFile || []) {
    const added = output.partitions.filter(partition => partition.sourceUnitId === current.sourceUnitId);
    if (!added.length) continue;
    for (const partition of added) {
      const context = contexts.get(partition.contextHash);
      if (!context?.sourceUnits.some(source => source.sourceUnitId === current.sourceUnitId && source.byteHash === current.sourceHash)) {
        throw Object.assign(new Error('Semantic provider source/context mismatch.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
      }
    }
    const partitions = [...new Map([...current.partitions, ...added].map(partition => [partition.partitionId, partition])).values()];
    const store = createArtifactSemanticStore({ root: path.join(runtime.buildRoot, current.storage.relativePath), repoRoot: runtime.root,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: current.storage.generation, partitions });
    const coverage = [...current.coverage];
    for (const partition of added) for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage', { signal })) coverage.push(row);
    state.semanticFactsByFile.set(file, createSemanticFactsRef({ source: { sourceUnitId: current.sourceUnitId,
      byteHash: current.sourceHash, repositoryNamespace: current.repositoryNamespace }, syntaxPartitionId: current.syntaxPartitionId,
    storage: current.storage, partitions, coverage }));
  }
  for (const partition of output.partitions) if (![...state.semanticFactsByFile.values()].some(facts => facts.sourceUnitId === partition.sourceUnitId)) {
    throw Object.assign(new Error('Semantic provider returned an unknown source.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  }
  state.semanticCompilerContexts = [...contexts.values()];
};
