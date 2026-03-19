import path from 'node:path';
import { toPosix } from '../../../shared/files.js';

/**
 * Track committed artifact files destined for the pieces manifest.
 *
 * @param {{outDir:string,resolveArtifactTier?:(artifactName:string)=>string}} input
 * @returns {{
 *   formatArtifactLabel:(filePath:string)=>string,
 *   addPieceFile:(entry:object,filePath:string)=>void,
 *   removePieceFile:(filePath:string)=>void,
 *   listPieceEntries:()=>object[],
 *   hasPieceFile:(filePath:string)=>boolean,
 *   updatePieceMetadata:(piecePath:string,meta?:object)=>void
 * }}
 */
export const createArtifactPieceRegistry = ({
  outDir,
  resolveArtifactTier = () => 'warm'
} = {}) => {
  const pieceEntriesByPath = new Map();
  let mmapHotLayoutOrder = 0;

  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));

  const resolvePieceTier = (entry, normalizedPath) => {
    const explicitTier = typeof entry?.tier === 'string' ? entry.tier.trim().toLowerCase() : null;
    if (explicitTier === 'hot' || explicitTier === 'warm' || explicitTier === 'cold') {
      return explicitTier;
    }
    const candidateName = typeof entry?.name === 'string' && entry.name
      ? entry.name
      : normalizedPath;
    return resolveArtifactTier(candidateName);
  };

  const addPieceFile = (entry, filePath) => {
    const normalizedPath = formatArtifactLabel(filePath);
    const tier = resolvePieceTier(entry, normalizedPath);
    const existingLayout = entry?.layout && typeof entry.layout === 'object'
      ? { ...entry.layout }
      : {};
    if (tier === 'hot') {
      if (!Number.isFinite(Number(existingLayout.order))) {
        existingLayout.order = mmapHotLayoutOrder;
        mmapHotLayoutOrder += 1;
      }
      existingLayout.group = typeof existingLayout.group === 'string' && existingLayout.group
        ? existingLayout.group
        : 'mmap-hot';
      if (typeof existingLayout.contiguous !== 'boolean') {
        existingLayout.contiguous = true;
      }
    } else {
      existingLayout.group = typeof existingLayout.group === 'string' && existingLayout.group
        ? existingLayout.group
        : (tier === 'cold' ? 'cold-storage' : 'warm-storage');
      if (typeof existingLayout.contiguous !== 'boolean') {
        existingLayout.contiguous = false;
      }
    }
    pieceEntriesByPath.set(normalizedPath, {
      ...entry,
      tier,
      layout: existingLayout,
      path: normalizedPath
    });
  };

  const removePieceFile = (filePath) => {
    if (!filePath) return;
    pieceEntriesByPath.delete(formatArtifactLabel(filePath));
  };

  const listPieceEntries = () => Array.from(pieceEntriesByPath.values());

  const hasPieceFile = (filePath) => (
    Boolean(filePath) && pieceEntriesByPath.has(formatArtifactLabel(filePath))
  );

  const updatePieceMetadata = (piecePath, meta = {}) => {
    if (typeof piecePath !== 'string' || !piecePath) return;
    const target = pieceEntriesByPath.get(piecePath);
    if (!target || typeof target !== 'object') return;
    const bytes = Number(meta?.bytes);
    const checksumValue = typeof meta?.checksum === 'string' ? meta.checksum.trim().toLowerCase() : null;
    const checksumAlgo = typeof meta?.checksumAlgo === 'string' ? meta.checksumAlgo.trim().toLowerCase() : null;
    if (Number.isFinite(bytes) && bytes >= 0) target.bytes = bytes;
    if (checksumValue && checksumAlgo) {
      target.checksum = `${checksumAlgo}:${checksumValue}`;
    } else if (typeof meta?.checksumHash === 'string' && meta.checksumHash.includes(':')) {
      target.checksum = meta.checksumHash.trim().toLowerCase();
    }
  };

  return {
    formatArtifactLabel,
    addPieceFile,
    removePieceFile,
    listPieceEntries,
    hasPieceFile,
    updatePieceMetadata
  };
};
