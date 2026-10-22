import path from 'node:path';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { createSemanticFactsRef } from './file-ref.js';
import { canonicalSemanticJson } from './identity.js';
import { validateSemanticPartitions } from './reconcile.js';
import { throwIfAborted } from '../../shared/abort.js';

const fail = (message) => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
const same = (left, right) => canonicalSemanticJson(left) === canonicalSemanticJson(right);

/** Validate the entire completed batch before atomically selecting any output.
 * Durable writers remain the publication owner; accepting descriptors is not a
 * claim that a query consumer has opened a published generation. */
export const mergeSemanticProviderOutput = async ({ output, state, runtime, signal }) => {
  throwIfAborted(signal);
  assertSemanticEnvelope('provider', output);
  canonicalSemanticJson(output);
  output = structuredClone(output);
  if (output.coverageRef !== null || output.diagnosticsRef !== null) throw fail('Unsupported provider sidecar reference.');
  const contexts = new Map((state.semanticCompilerContexts || []).map(context => [context.contextKey, context]));
  const inventory = new Map(), bySource = new Map();
  for (const [file, current] of state.semanticFactsByFile || []) {
    assertSemanticEnvelope('fileFactsRef', current);
    const previous = bySource.get(current.sourceUnitId);
    if (previous && !same(previous.current, current)) throw fail('Conflicting immutable source inventory.');
    bySource.set(current.sourceUnitId, { file, current });
    for (const partition of current.partitions) {
      if (inventory.has(partition.partitionId) && !same(inventory.get(partition.partitionId), partition)) throw fail('Conflicting immutable partition inventory.');
      inventory.set(partition.partitionId, partition);
    }
  }
  for (const context of output.contexts) {
    if (contexts.has(context.contextKey) && !same(contexts.get(context.contextKey), context)) throw fail('Conflicting provider context identity.');
    const sources = new Set();
    for (const source of context.sourceUnits) {
      const entry = bySource.get(source.sourceUnitId);
      if (sources.has(source.sourceUnitId) || !entry || entry.current.sourceHash !== source.byteHash) throw fail('Unknown, duplicate or stale provider context source.');
      sources.add(source.sourceUnitId);
    }
    contexts.set(context.contextKey, context);
  }
  const additions = new Map();
  for (const partition of output.partitions) {
    const entry = bySource.get(partition.sourceUnitId), context = contexts.get(partition.contextHash);
    if (!entry || !context?.sourceUnits.some(source => source.sourceUnitId === entry.current.sourceUnitId && source.byteHash === entry.current.sourceHash)) throw fail('Semantic provider source/context mismatch.');
    const previous = inventory.get(partition.partitionId);
    if (previous && !same(previous, partition)) throw fail('Provider attempted to replace an immutable partition.');
    if (!previous && partition.partitionId.startsWith('sy1:')) throw fail('Provider cannot introduce replacement syntax.');
    if (!previous) additions.set(partition.partitionId, partition);
    inventory.set(partition.partitionId, partition);
  }
  const pending = new Map();
  for (const [file, current] of state.semanticFactsByFile || []) {
    throwIfAborted(signal);
    const added = [...additions.values()].filter(partition => partition.sourceUnitId === current.sourceUnitId);
    if (!added.length) continue;
    const root = path.resolve(runtime.buildRoot, current.storage.relativePath);
    const references = [...inventory.values()].filter(partition => {
      const facts = bySource.get(partition.sourceUnitId)?.current;
      return facts && path.resolve(runtime.buildRoot, facts.storage.relativePath) === root
        && same(facts.storage.generation, current.storage.generation)
        && facts.repositoryNamespace === current.repositoryNamespace;
    });
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: current.storage.generation, partitions: references });
    await validateSemanticPartitions({ store, partitions: added, referencePartitions: references, signal });
    const coverage = [...current.coverage];
    for (const partition of added) {
      for await (const record of store.iterateRows(partition.partitionId, 'semantic_records', { signal })) {
        if (['scope', 'declaration', 'occurrence', 'statement', 'expression', 'literal'].includes(record.kind)) throw fail('Provider syntax must be admitted by the parser stage.');
      }
      for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) {
        if (source.byteHash !== current.sourceHash || source.repositoryNamespace !== current.repositoryNamespace) throw fail('Persisted provider source differs from admitted source.');
      }
      for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage', { signal })) coverage.push(row);
    }
    pending.set(file, createSemanticFactsRef({ source: { sourceUnitId: current.sourceUnitId,
      byteHash: current.sourceHash, repositoryNamespace: current.repositoryNamespace },
    syntaxPartitionId: current.syntaxPartitionId, storage: current.storage,
    partitions: [...current.partitions, ...added], coverage }));
  }
  throwIfAborted(signal);
  for (const [file, facts] of pending) state.semanticFactsByFile.set(file, facts);
  state.semanticCompilerContexts = [...contexts.values()];
  return { accepted: output.partitions.length, persisted: additions.size, unchanged: output.partitions.length - additions.size };
};

export const createSemanticProviderResultSink = ({ state, runtime, signal = null }) =>
  (output) => mergeSemanticProviderOutput({ output, state, runtime, signal });
