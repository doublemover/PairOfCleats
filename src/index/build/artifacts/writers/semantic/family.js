import { semanticHash, canonicalSemanticJson } from '../../../../semantic/identity.js';
import { semanticTaskInputHash } from '../../../../semantic/frontier.js';
import { createHash } from 'node:crypto';
import { writeSemanticQueryIndex } from './query-index.js';
import { createSemanticDiskAccount } from './partition.js';
import { assertSemanticEnvelope } from '../../../../../contracts/validators/semantic-envelopes.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createArtifactSemanticStore } from '../../../../../semantic/artifact-store.js';
import { validateSemanticPartitions } from '../../../../semantic/reconcile.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../../../contracts/schemas/semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../../contracts/versioning.js';
import { writeJsonObjectFile } from '../../../../../shared/json-stream/json-writers.js';

/** Existing write queue owns this family; existing whole-build promoter exposes it. */
export const enqueueSemanticArtifacts = ({ state, root, outDir, indexState, enabled,
  enqueueWrite, addPieceFile, declareArtifactFamily, signal }) => {
  const descriptors = [...(state.semanticFactsByFile?.values() || [])];
  const descriptorsBySource = new Map(descriptors.map((entry) => [entry.sourceUnitId, entry]));
  const partitions = descriptors.flatMap((entry) => assertSemanticEnvelope('fileFactsRef', entry).partitions).sort((a, b) => a.partitionId.localeCompare(b.partitionId));
  const frontierTargets = state.semanticFrontierTargets || [];
  const completedTasks = state.semanticCompletedTasks || [];
  const generation = { baseBuildId: indexState.buildId, semanticRevision: 0 };
  for (const descriptor of descriptors) {
    if (descriptor.storage.generation.baseBuildId !== generation.baseBuildId) {
      throw Object.assign(new Error('Semantic file descriptor generation mismatch.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
    }
  }
  declareArtifactFamily({ family: 'semantic', owner: 'semantic', requiredMembers: ['semantic_manifest', 'semantic_query_index', ...SEMANTIC_MEMBER_NAMES, ...(frontierTargets.length ? ['semantic_frontier_targets'] : [])] });
  enqueueWrite('semantic-family', async () => {
    const semanticRoot = path.join(outDir, 'semantic');
    const store = createArtifactSemanticStore({ root: semanticRoot, repoRoot: root,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions });
    await validateSemanticPartitions({ store, partitions, signal });
    const manifest = { schemaVersion: 1, semanticSchemaVersion: 1,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation,
      status: enabled ? 'partial' : 'disabled', partitions, contexts: state.semanticCompilerContexts || [], frontierTargets, completedTasks,
      warnings: enabled ? ['Bindings, local flow and unsupported source collectors are not yet complete.'] : [] };
    const targetPaths = new Map();
    for (const target of frontierTargets) {
      if (!/^semantic-frontier-targets\/[a-f0-9]{64}\.json$/.test(target.path)) throw new Error('Invalid semantic frontier target path.');
      const bytes = await fs.readFile(path.join(semanticRoot, target.path));
      if (bytes.length !== target.bytes || createHash('sha256').update(bytes).digest('hex') !== target.hash) {
        throw new Error('Semantic frontier target hash mismatch.');
      }
      targetPaths.set(target.path, { ...target, payload: JSON.parse(bytes.toString('utf8')) });
    }
    const tasks = new Map();
    for (const partition of partitions) for await (const task of store.iterateRows(partition.partitionId, 'semantic_frontier', { signal })) {
      const target = targetPaths.get(task.targetsRef);
      if (!target || task.baseBuildId !== generation.baseBuildId
        || canonicalSemanticJson(target.payload.generation) !== canonicalSemanticJson(generation)
        || semanticHash('pairofcleats.semantic.binding-targets.v1', target.payload) !== task.targetSetHash) {
        throw new Error('Semantic frontier target/generation mismatch.');
      }
      tasks.set(task.taskId, task);
    }
    for (const receipt of completedTasks) {
      const task = tasks.get(receipt.taskId);
      if (!task || receipt.baseBuildId !== generation.baseBuildId || receipt.policyHash !== task.policyHash || receipt.inputHash !== semanticTaskInputHash(task)) {
        throw new Error('Semantic completion receipt mismatch.');
      }
    }
    await writeJsonObjectFile(path.join(outDir, 'semantic_manifest.json'), { fields: manifest, atomic: true });
    const register = (name, filePath, count = 0) => addPieceFile({ type: 'semantic', name,
      format: filePath.endsWith('.jsonl') ? 'jsonl' : filePath.endsWith('.json') ? 'json' : 'binary', count }, filePath);
    for (const target of frontierTargets) register('semantic_frontier_targets', path.join(semanticRoot, target.path));
    register('semantic_manifest', path.join(outDir, 'semantic_manifest.json'), partitions.length);
    const queryIndex = await writeSemanticQueryIndex({ root: semanticRoot, repoRoot: root, generation, partitions, store,
      diskAccount: state.semanticDiskAccount || createSemanticDiskAccount(0), signal });
    await writeJsonObjectFile(path.join(outDir, 'semantic_query_index.json'), { fields: queryIndex, atomic: true });
    register('semantic_query_index', path.join(outDir, 'semantic_query_index.json'), queryIndex.rowCount);
    for (const piece of queryIndex.pieces) {
      register('semantic_query_index_rows', path.join(semanticRoot, piece.path), piece.count);
      register('semantic_query_index_offsets', path.join(semanticRoot, piece.offsetsPath), piece.count);
    }
    for (const member of SEMANTIC_MEMBER_NAMES) {
      const inventory = partitions.map((p) => ({ partitionId: p.partitionId, pieces: p.members[member] }));
      const filePath = path.join(outDir, member + '.json');
      await writeJsonObjectFile(filePath, { fields: { schemaVersion: 1, generation, partitions: inventory }, atomic: true });
      register(member, filePath, inventory.length);
      for (const partition of partitions) for (const piece of partition.members[member]) {
        register(member, path.join(semanticRoot, piece.path), piece.count);
        register(member + '_offsets', path.join(semanticRoot, piece.offsetsPath), piece.count);
      }
    }
    const registered = new Set();
    for (const partition of partitions) {
      for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) {
        const descriptor = descriptorsBySource.get(source.sourceUnitId);
        if (!descriptor || descriptor.sourceHash !== source.byteHash || descriptor.repositoryNamespace !== source.repositoryNamespace) {
          throw Object.assign(new Error('Semantic descriptor/source identity mismatch.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
        }
        const filePath = path.join(semanticRoot, 'semantic-sources', source.byteHash + '.utf8');
        if (!registered.has(filePath)) { await fs.stat(filePath); register('semantic_source_text', filePath); registered.add(filePath); }
      }
    }
  }, { family: 'semantic' });
};
