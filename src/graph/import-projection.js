import { nodeKey } from './ordering.js';

/** A projected endpoint is an alias of an indexed containing file, never a
 * chunk-level import assertion. The canonical import endpoints stay explicit. */
export const createImportProjection = (chunkUid, containingFile, fromFile, toFile) => ({
  version: 1, kind: 'chunk-containing-file-import', chunkUid, containingFile, fromFile, toFile
});

export const importProjectionError = (edge, resolveContainingFile = null) => {
  const projection = edge?.importProjection;
  if (projection === undefined) return null;
  if (!projection || projection.version !== 1 || projection.kind !== 'chunk-containing-file-import'
    || Object.keys(projection).length !== 6
    || !['chunkUid', 'containingFile', 'fromFile', 'toFile'].every(key => typeof projection[key] === 'string' && projection[key])
    || edge.edgeType !== 'import' || edge.graph !== undefined && edge.graph !== 'importGraph'
    || projection.fromFile !== projection.containingFile && projection.toFile !== projection.containingFile) {
    return 'Invalid typed containing-file import projection.';
  }
  const endpoint = file => file === projection.containingFile
    ? { type: 'chunk', chunkUid: projection.chunkUid } : { type: 'file', path: file };
  if (nodeKey(edge.from) !== nodeKey(endpoint(projection.fromFile))
    || nodeKey(edge.to) !== nodeKey(endpoint(projection.toFile))) return 'Projected import differs from its canonical file endpoints.';
  if (resolveContainingFile && resolveContainingFile(projection.chunkUid) !== projection.containingFile) {
    return 'Projected import differs from the selected generation containing-file fact.';
  }
  return null;
};
