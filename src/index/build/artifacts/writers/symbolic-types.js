import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../../contracts/versioning.js';
import { writeJsonObjectFile } from '../../../../shared/json-stream/json-writers.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { mergeSymbolicTypeGraphs, measureSymbolicTypeGraph, validateTypeExpressionReferences,
  validateSymbolicTypeManifest, symbolicTypeError } from '../../../../shared/symbolic-types.js';

/** The normal writer queue/piece registry and whole-build promoter own this family. */
export const enqueueSymbolicTypeArtifacts = ({ state, outDir, indexState, enqueueWrite,
  addPieceFile, declareArtifactFamily, signal = null }) => {
  const graphs = mergeSymbolicTypeGraphs([], state.symbolicTypeGraphs || []);
  const inventory = new Map(graphs.map(entry => [entry.graphId, entry]));
  for (const chunk of state.chunks || []) {
    throwIfAborted(signal);
    for (const expressions of [chunk.docmeta?.typeExpressions, chunk.metaV2?.types?.expressions]) {
      if (expressions != null) validateTypeExpressionReferences(expressions, inventory);
    }
  }
  if (!graphs.length) return;
  if (typeof indexState?.buildId !== 'string' || !indexState.buildId) {
    throw symbolicTypeError('symbolic_type_generation_mismatch', 'Symbolic types require a pinned build identity.');
  }
  declareArtifactFamily({ family: 'symbolic-types', owner: 'tooling',
    requiredMembers: ['symbolic_type_manifest', 'symbolic_type_graph'] });
  enqueueWrite('symbolic-types', async () => {
    const graphDir = path.join(outDir, 'symbolic-types');
    await fs.mkdir(graphDir, { recursive: true });
    const descriptors = [];
    for (const entry of graphs) {
      throwIfAborted(signal);
      const { hash, bytes } = measureSymbolicTypeGraph(entry.graph);
      const relativePath = 'symbolic-types/' + hash + '.json';
      const filePath = path.join(outDir, relativePath);
      const { nodes, ...fields } = entry.graph;
      const canonicalNodes = function* () {
        for (const node of nodes) yield node.kind === 'Literal'
          ? { id: node.id, kind: node.kind, value: node.value }
          : { id: node.id, kind: node.kind, children: node.children };
      };
      await writeJsonObjectFile(filePath, { fields: {
        schemaVersion: fields.schemaVersion, domain: fields.domain, contextKey: fields.contextKey, rootIds: fields.rootIds
      }, arrays: { nodes: canonicalNodes() }, atomic: true, trailingNewline: false, signal });
      if ((await fs.stat(filePath)).size !== bytes) throw symbolicTypeError('symbolic_type_corrupt', 'Symbolic graph write length mismatch.');
      addPieceFile({ type: 'symbolic-types', name: 'symbolic_type_graph', format: 'json',
        count: nodes.length, bytes }, filePath);
      descriptors.push({ graphId: entry.graphId, contextKey: entry.graph.contextKey, path: relativePath,
        hash, bytes, nodeCount: nodes.length });
    }
    const manifest = validateSymbolicTypeManifest({ schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      generation: { baseBuildId: indexState.buildId, semanticRevision: 0 }, status: 'complete', graphs: descriptors });
    const manifestPath = path.join(outDir, 'symbolic_type_manifest.json');
    await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });
    addPieceFile({ type: 'symbolic-types', name: 'symbolic_type_manifest', format: 'json', count: graphs.length }, manifestPath);
  }, { family: 'symbolic-types' });
};
