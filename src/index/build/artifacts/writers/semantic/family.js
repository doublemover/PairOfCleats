import { semanticHash, canonicalSemanticJson } from '../../../../semantic/identity.js';
import { semanticTaskInputHash } from '../../../../semantic/frontier.js';
import { createHash } from 'node:crypto';
import { writeValidatedSemanticIndexes } from './validated-indexes.js';
import { createSemanticDiskAccount } from './partition.js';
import { assertSemanticEnvelope } from '../../../../../contracts/validators/semantic-envelopes.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createArtifactSemanticStore } from '../../../../../semantic/artifact-store.js';
import { SEMANTIC_MEMBER_NAMES } from '../../../../../contracts/schemas/semantic-envelopes.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../../../contracts/versioning.js';
import { writeSemanticJson } from '../../../../semantic/disk-writes.js';
import { normalizeSemanticConfig } from '../../../../semantic/config.js';

/** Existing write queue owns this family; existing whole-build promoter exposes it. */
export const enqueueSemanticArtifacts = ({ state, root, outDir, indexState, enabled,
  enqueueWrite, addPieceFile, declareArtifactFamily, signal }) => {
  const descriptors = [...(state.semanticFactsByFile?.values() || [])];
  const descriptorsBySource = new Map(descriptors.map((entry) => [entry.sourceUnitId, entry]));
  const partitions = descriptors.flatMap((entry) => assertSemanticEnvelope('fileFactsRef', entry).partitions).sort((a, b) => a.partitionId.localeCompare(b.partitionId));
  const frontierTargets = state.semanticFrontierTargets || [];
  const completedTasks = state.semanticCompletedTasks || [];
  const evidenceArtifacts = [...new Map((state.semanticEvidenceArtifacts || []).map(row => [row.path, row])).values()];
  const generation = { baseBuildId: indexState.buildId, semanticRevision: 0 };
  for (const descriptor of descriptors) {
    if (descriptor.storage.generation.baseBuildId !== generation.baseBuildId) {
      throw Object.assign(new Error('Semantic file descriptor generation mismatch.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
    }
  }
  declareArtifactFamily({ family: 'semantic', owner: 'semantic', requiredMembers: ['semantic_manifest', 'semantic_query_index', 'semantic_operation_index', ...SEMANTIC_MEMBER_NAMES, ...(frontierTargets.length ? ['semantic_frontier_targets'] : []), ...(evidenceArtifacts.length ? ['semantic_evidence'] : [])] });
  enqueueWrite('semantic-family', async () => {
    const diskAccount = state.semanticDiskAccount || createSemanticDiskAccount(normalizeSemanticConfig().storage.maxDiskWorkingSetBytes);
    const semanticRoot = path.join(outDir, 'semantic');
    const store = createArtifactSemanticStore({ root: semanticRoot, repoRoot: root,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions });
    const planning = [...(state.semanticPlanningBySource?.values() || [])].map(plan => {
      const descriptor = descriptorsBySource.get(plan.sourceUnitId);
      if (!descriptor || descriptor.sourceHash !== plan.sourceHash || descriptor.syntaxPartitionId !== plan.syntaxPartitionId) throw new Error('Semantic planning/source identity mismatch.');
      return { ...plan, extractionHash: descriptor.extractionHash, canonicalHash: descriptor.canonicalHash };
    }).sort((a, b) => a.sourceUnitId.localeCompare(b.sourceUnitId));
    const manifest = { schemaVersion: 1, semanticSchemaVersion: 1,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation,
      status: enabled ? 'partial' : 'disabled', partitions, contexts: state.semanticCompilerContexts || [], frontierTargets, completedTasks, evidenceArtifacts, planning, compilerAdmissions: state.semanticCompilerAdmissions || [],
      warnings: enabled ? ['Bindings, local flow and unsupported source collectors are not yet complete.'] : [] };
    for (const artifact of evidenceArtifacts) {
      if (!/^semantic-evidence\/[a-f0-9]{64}\.json$/.test(artifact.path)) throw new Error('Invalid semantic evidence path.');
      const bytes = await fs.readFile(path.join(semanticRoot, artifact.path));
      if (bytes.length !== artifact.bytes || createHash('sha256').update(bytes).digest('hex') !== artifact.hash) throw new Error('Semantic evidence hash mismatch.');
    }
    const targetPaths = new Map();
    for (const target of frontierTargets) {
      if (!/^semantic-frontier-targets\/[a-f0-9]{64}\.json$/.test(target.path)) throw new Error('Invalid semantic frontier target path.');
      const bytes = await fs.readFile(path.join(semanticRoot, target.path));
      if (bytes.length !== target.bytes || createHash('sha256').update(bytes).digest('hex') !== target.hash) {
        throw new Error('Semantic frontier target hash mismatch.');
      }
      targetPaths.set(target.path, { ...target, payload: JSON.parse(bytes.toString('utf8')) });
    }
    const tasks = new Map(), sources = new Map();
    const partitionRanks = new Map(partitions.map((partition, rank) => [partition.partitionId, rank]));
    const [queryIndex, operationIndex] = await writeValidatedSemanticIndexes({
      root: semanticRoot, generation, partitions, store, diskAccount, signal,
      onValidatedRow({ partition, member, row, rowOrdinal }) {
        if (member === 'semantic_sources') {
          const descriptor = descriptorsBySource.get(row.sourceUnitId);
          if (!descriptor || descriptor.sourceHash !== row.byteHash || descriptor.repositoryNamespace !== row.repositoryNamespace) {
            throw Object.assign(new Error('Semantic descriptor/source identity mismatch.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
          }
          sources.set(partition.partitionId, path.join(semanticRoot, 'semantic-sources', row.byteHash + '.utf8'));
        }
        if (member !== 'semantic_frontier') return;
        const target = targetPaths.get(row.targetsRef);
        if (!target || row.baseBuildId !== generation.baseBuildId
          || canonicalSemanticJson(target.payload.generation) !== canonicalSemanticJson(generation)
          || semanticHash('pairofcleats.semantic.binding-targets.v1', target.payload) !== row.targetSetHash) {
          throw new Error('Semantic frontier target/generation mismatch.');
        }
        // Preserve the previous sorted-partition/row last-write precedence,
        // independent of which bounded validation worker reaches this row first.
        const rank = partitionRanks.get(partition.partitionId), previous = tasks.get(row.taskId);
        if (!previous || rank > previous.rank || rank === previous.rank && rowOrdinal > previous.rowOrdinal) {
          tasks.set(row.taskId, { task: row, rank, rowOrdinal });
        }
      },
      async afterValidation() {
        const evidencePaths = new Set(evidenceArtifacts.map(item => item.path));
        for (const admission of manifest.compilerAdmissions) {
          if (!evidencePaths.has(admission.decisionRef) || (admission.receiptRef && !evidencePaths.has(admission.receiptRef))
            || admission.taskIds.some(id => !tasks.has(id))) throw new Error('Semantic compiler admission evidence mismatch.');
        }
        for (const receipt of completedTasks) {
          const task = tasks.get(receipt.taskId)?.task;
          if (!task || receipt.baseBuildId !== generation.baseBuildId || receipt.policyHash !== task.policyHash || receipt.inputHash !== semanticTaskInputHash(task)) {
            throw new Error('Semantic completion receipt mismatch.');
          }
        }
        const verified = new Set();
        for (const partition of partitions) {
          const filename = sources.get(partition.partitionId);
          if (!verified.has(filename)) { await fs.stat(filename); verified.add(filename); }
        }
      }
    });
    await writeSemanticJson({ filename: path.join(outDir, 'semantic_manifest.json'), value: manifest, diskAccount, signal });
    const register = (name, filePath, count = 0, sealedHash = null, bytes = null) => {
      if (sealedHash != null && !/^[a-f0-9]{64}$/.test(sealedHash)) throw new Error('Invalid sealed semantic checksum.');
      addPieceFile({ type: 'semantic', name,
        format: filePath.endsWith('.jsonl') ? 'jsonl' : filePath.endsWith('.json') ? 'json' : 'binary', count,
        ...(sealedHash ? { checksum: `sha256:${sealedHash}` } : {}),
        ...(Number.isSafeInteger(bytes) && bytes >= 0 ? { bytes } : {}) }, filePath);
    };
    for (const artifact of evidenceArtifacts) register('semantic_evidence', path.join(semanticRoot, artifact.path), 0, artifact.hash, artifact.bytes);
    for (const target of frontierTargets) register('semantic_frontier_targets', path.join(semanticRoot, target.path), 0, target.hash, target.bytes);
    register('semantic_manifest', path.join(outDir, 'semantic_manifest.json'), partitions.length);
    await writeSemanticJson({ filename: path.join(outDir, 'semantic_query_index.json'), value: queryIndex, diskAccount, signal });
    register('semantic_query_index', path.join(outDir, 'semantic_query_index.json'), queryIndex.rowCount);
    for (const piece of queryIndex.pieces) {
      register('semantic_query_index_rows', path.join(semanticRoot, piece.path), piece.count, piece.hash, piece.bytes);
      register('semantic_query_index_offsets', path.join(semanticRoot, piece.offsetsPath), piece.count, piece.offsetsHash);
    }
    await writeSemanticJson({ filename: path.join(outDir, 'semantic_operation_index.json'), value: operationIndex, diskAccount, signal });
    register('semantic_operation_index', path.join(outDir, 'semantic_operation_index.json'), operationIndex.rowCount);
    for (const piece of operationIndex.pieces) {
      register('semantic_operation_index_rows', path.join(semanticRoot, piece.path), piece.count, piece.hash, piece.bytes);
      register('semantic_operation_index_offsets', path.join(semanticRoot, piece.offsetsPath), piece.count, piece.offsetsHash);
    }
    for (const member of SEMANTIC_MEMBER_NAMES) {
      const inventory = partitions.map((p) => ({ partitionId: p.partitionId, pieces: p.members[member] }));
      const filePath = path.join(outDir, member + '.json');
      await writeSemanticJson({ filename: filePath, value: { schemaVersion: 1, generation, partitions: inventory }, diskAccount, signal });
      register(member, filePath, inventory.length);
      for (const partition of partitions) for (const piece of partition.members[member]) {
        register(member, path.join(semanticRoot, piece.path), piece.count, piece.hash, piece.bytes);
        register(member + '_offsets', path.join(semanticRoot, piece.offsetsPath), piece.count, piece.offsetsHash);
      }
    }
    const registered = new Set();
    for (const partition of partitions) {
      const filePath = sources.get(partition.partitionId);
      if (!registered.has(filePath)) { register('semantic_source_text', filePath); registered.add(filePath); }
    }
  }, { family: 'semantic' });
};
