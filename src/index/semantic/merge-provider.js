import path from 'node:path';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { SEMANTIC_FILE_FACTS_REF_SCHEMA } from '../../contracts/schemas/semantic-envelopes.js';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { createSemanticFactsRef } from './file-ref.js';
import { validateSemanticPartitions } from './reconcile.js';
import { createProviderMergeAdmission } from './provider-merge-admission.js';
import { composeAbortSignals, throwIfAborted } from '../../shared/abort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
const syntaxKinds = new Set(['scope', 'declaration', 'occurrence', 'statement', 'expression', 'literal']);
const MAX_COVERAGE_ROWS = SEMANTIC_FILE_FACTS_REF_SCHEMA.properties.coverage.maxItems;

/** Capture and validate one completed batch before selecting any output. Groups,
 * reference inventories, context memberships and row checks are operation-local.
 * Durable writers remain publication owners; admission is not query consumption.
 */
export const mergeSemanticProviderOutput = async ({ output, state, runtime, signal }) => {
  throwIfAborted(signal);
  const buildRoot = path.resolve(runtime.buildRoot), repoRoot = path.resolve(runtime.root);
  const admission = createProviderMergeAdmission(signal), work = admission.work;
  output = admission.capture(output).value;
  assertSemanticEnvelope('provider', output);
  if (output.coverageRef !== null || output.diagnosticsRef !== null) throw fail('Unsupported provider sidecar reference.');
  const selected = state.semanticFactsByFile, originalContexts = state.semanticCompilerContexts;
  const contextSnapshot = admission.capture(originalContexts || []);
  const contexts = new Map(), inventory = new Map(), bySource = new Map(), groups = new Map(), files = new Map();
  for (const [file, raw] of selected || []) {
    admission.visit(); work.currentFiles++;
    if (typeof file !== 'string') throw fail('Semantic source inventory requires file identities.');
    admission.identity(file);
    const captured = admission.capture(raw), current = captured.value;
    assertSemanticEnvelope('fileFactsRef', current);
    const previous = bySource.get(current.sourceUnitId);
    if (previous && previous.canonical !== captured.canonical) throw fail('Conflicting immutable source inventory.');
    const root = path.resolve(buildRoot, current.storage.relativePath); work.rootDerivations++;
    const generationKey = admission.identity(current.storage.generation); work.generationKeys++;
    const groupKey = admission.identity([root, generationKey, current.repositoryNamespace]);
    let group = groups.get(groupKey);
    if (!group) {
      admission.visit(); group = { root, generation: current.storage.generation, references: [], additions: [] };
      groups.set(groupKey, group);
    }
    const entry = previous || { current, canonical: captured.canonical, group, files: [], additions: [] };
    const fileEntry = { file, raw, current, canonical: captured.canonical };
    files.set(file, fileEntry); entry.files.push(fileEntry); bySource.set(current.sourceUnitId, entry);
    for (const partition of current.partitions) {
      admission.visit(); const canonical = admission.identity(partition), existing = inventory.get(partition.partitionId);
      if (existing && existing.canonical !== canonical) throw fail('Conflicting immutable partition inventory.');
      if (!existing) inventory.set(partition.partitionId, { partition, canonical, entry });
    }
  }
  const admitContext = (context, joinSources) => {
    admission.visit(); const canonical = admission.identity(context), previous = contexts.get(context.contextKey);
    if (previous && previous.canonical !== canonical) throw fail('Conflicting provider context identity.');
    let value = previous;
    if (!value) {
      const members = new Map();
      for (const source of context.sourceUnits) {
        admission.visit(); work.contextSourceVisits++;
        if (members.has(source.sourceUnitId)) throw fail('Duplicate provider context source.');
        members.set(source.sourceUnitId, source.byteHash);
      }
      value = { context, canonical, members, joined: false }; contexts.set(context.contextKey, value);
    }
    if (joinSources && !value.joined) {
      for (const [sourceUnitId, sourceHash] of value.members) {
        admission.check(); const entry = bySource.get(sourceUnitId);
        if (!entry || entry.current.sourceHash !== sourceHash) throw fail('Unknown or stale provider context source.');
      }
      value.joined = true;
    }
  };
  for (const context of contextSnapshot.value) admitContext(context, false);
  for (const context of output.contexts) admitContext(context, true);
  let additions = 0;
  for (const partition of output.partitions) {
    admission.visit(); const entry = bySource.get(partition.sourceUnitId), context = contexts.get(partition.contextHash);
    if (!entry || context?.members.get(entry.current.sourceUnitId) !== entry.current.sourceHash) throw fail('Semantic provider source/context mismatch.');
    const canonical = admission.identity(partition), previous = inventory.get(partition.partitionId);
    if (previous && previous.canonical !== canonical) throw fail('Provider attempted to replace an immutable partition.');
    if (!previous && partition.partitionId.startsWith('sy1:')) throw fail('Provider cannot introduce replacement syntax.');
    if (!previous) {
      inventory.set(partition.partitionId, { partition, canonical, entry });
      entry.additions.push(partition); entry.group.additions.push(partition); additions++;
    }
  }
  for (const { partition } of inventory.values()) {
    admission.check(); const source = bySource.get(partition.sourceUnitId);
    if (source) source.group.references.push(partition);
  }
  const coverageByPartition = new Map();
  for (const group of groups.values()) {
    if (!group.additions.length) continue;
    admission.check(); work.groupPreparations++; work.inventoryPreparations++;
    const store = createArtifactSemanticStore({ root: group.root, repoRoot,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: group.generation, partitions: group.references });
    for (const partition of group.additions) coverageByPartition.set(partition.partitionId, []);
    await store.withReadScope(() => validateSemanticPartitions({ store, partitions: group.additions, referencePartitions: group.references, signal,
      onValidatedRow({ partition, member, row }) {
        admission.check(); work.memberRowsValidated++;
        const entry = bySource.get(partition.sourceUnitId);
        if (member === 'semantic_records' && syntaxKinds.has(row.kind)) throw fail('Provider syntax must be admitted by the parser stage.');
        if (member === 'semantic_sources' && (row.byteHash !== entry.current.sourceHash
          || row.repositoryNamespace !== entry.current.repositoryNamespace)) throw fail('Persisted provider source differs from admitted source.');
        if (member === 'semantic_coverage') {
          const coverage = coverageByPartition.get(partition.partitionId);
          // The authoritative fileFactsRef coverage envelope permits512 rows.
          // Keep this provisional collection bounded before final selection.
          if (coverage.length >= MAX_COVERAGE_ROWS) throw fail('Provider coverage exceeds the admitted file envelope.');
          admission.visit(); admission.identity(row);
          coverage.push(row);
        }
      }
    }));
  }
  const pending = new Map();
  for (const entry of bySource.values()) {
    if (!entry.additions.length) continue;
    for (const { file, current } of entry.files) {
      admission.check(); const coverage = [...current.coverage];
      for (const partition of entry.additions) {
        const added = coverageByPartition.get(partition.partitionId);
        if (coverage.length + added.length > MAX_COVERAGE_ROWS) throw fail('Provider coverage exceeds the admitted file envelope.');
        coverage.push(...added);
      }
      pending.set(file, createSemanticFactsRef({ source: { sourceUnitId: current.sourceUnitId,
        byteHash: current.sourceHash, repositoryNamespace: current.repositoryNamespace },
      syntaxPartitionId: current.syntaxPartitionId, storage: current.storage,
      partitions: [...current.partitions, ...entry.additions], coverage }));
    }
  }
  throwIfAborted(signal);
  if (path.resolve(runtime.buildRoot) !== buildRoot || path.resolve(runtime.root) !== repoRoot
    || state.semanticFactsByFile !== selected || (selected?.size ?? 0) !== files.size
    || state.semanticCompilerContexts !== originalContexts
    || !admission.matchesCurrent(originalContexts || [], contextSnapshot.canonical)) throw fail('Semantic selection changed during provider admission.');
  for (const { file, raw, canonical } of files.values()) {
    if (selected.get(file) !== raw || !admission.matchesCurrent(raw, canonical)) throw fail('Semantic source changed during provider admission.');
  }
  throwIfAborted(signal);
  for (const [file, facts] of pending) selected.set(file, facts);
  state.semanticCompilerContexts = [...contexts.values()].map(value => value.context);
  const result = { accepted: output.partitions.length, persisted: additions, unchanged: output.partitions.length - additions };
  Object.defineProperty(result, 'work', { value: admission.snapshot() });
  return result;
};

export const createSemanticProviderResultSink = ({ state, runtime, signal = null }) =>
  (output, { signal: operationSignal = null } = {}) => mergeSemanticProviderOutput({ output, state, runtime,
    signal: composeAbortSignals(signal, operationSignal) });
