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
  const partitions = descriptors.flatMap((entry) => entry.partitions || [entry.partition]).sort((a, b) => a.partitionId.localeCompare(b.partitionId));
  const generation = { baseBuildId: indexState.buildId, semanticRevision: 0 };
  declareArtifactFamily({ family: 'semantic', owner: 'semantic', requiredMembers: ['semantic_manifest', ...SEMANTIC_MEMBER_NAMES] });
  enqueueWrite('semantic-family', async () => {
    const semanticRoot = path.join(outDir, 'semantic');
    const store = createArtifactSemanticStore({ root: semanticRoot, repoRoot: root,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation, partitions });
    await validateSemanticPartitions({ store, partitions, signal });
    const manifest = { schemaVersion: 1, semanticSchemaVersion: 1,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation,
      status: enabled ? 'partial' : 'disabled', partitions,
      warnings: enabled ? ['Bindings, local flow and unsupported source collectors are not yet complete.'] : [] };
    await writeJsonObjectFile(path.join(outDir, 'semantic_manifest.json'), { fields: manifest, atomic: true });
    const register = (name, filePath, count = 0) => addPieceFile({ type: 'semantic', name,
      format: filePath.endsWith('.jsonl') ? 'jsonl' : filePath.endsWith('.json') ? 'json' : 'binary', count }, filePath);
    register('semantic_manifest', path.join(outDir, 'semantic_manifest.json'), partitions.length);
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
        const filePath = path.join(semanticRoot, 'semantic-sources', source.byteHash + '.utf8');
        if (!registered.has(filePath)) { await fs.stat(filePath); register('semantic_source_text', filePath); registered.add(filePath); }
      }
    }
  }, { family: 'semantic' });
};
