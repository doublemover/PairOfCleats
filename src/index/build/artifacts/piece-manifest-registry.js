import path from 'node:path';

import { toPosix } from '../../../shared/files.js';

/**
 * Resolve piece tier (`hot`/`warm`/`cold`) from explicit metadata or policy.
 *
 * @param {object} input
 * @param {object} [input.entry]
 * @param {string} input.normalizedPath
 * @param {(name:string)=>string} input.resolveArtifactTier
 * @returns {string}
 */
export function resolvePieceTier({ entry, normalizedPath, resolveArtifactTier }) {
  const explicitTier = typeof entry?.tier === 'string' ? entry.tier.trim().toLowerCase() : null;
  if (explicitTier === 'hot' || explicitTier === 'warm' || explicitTier === 'cold') {
    return explicitTier;
  }
  const candidateName = typeof entry?.name === 'string' && entry.name
    ? entry.name
    : normalizedPath;
  return resolveArtifactTier(candidateName);
}

/**
 * Build piece-manifest bookkeeping helpers for artifact writes.
 *
 * @param {object} input
 * @param {string} input.outDir
 * @param {(name:string)=>string} input.resolveArtifactTier
 * @returns {{pieceEntries:object[],formatArtifactLabel:(filePath:string)=>string,addPieceFile:(entry:object,filePath:string)=>void,updatePieceMetadata:(piecePath:string,meta?:object)=>void}}
 */
export function createPieceManifestRegistry({ outDir, resolveArtifactTier }) {
  const pieceEntries = [];
  const pieceEntriesByPath = new Map();
  let mmapHotLayoutOrder = 0;

  /**
   * Convert artifact path to output-root relative label.
   *
   * @param {string} filePath
   * @returns {string}
   */
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));

  /**
   * Register one written artifact file in the pieces manifest.
   *
   * @param {object} entry
   * @param {string} filePath
   * @returns {void}
   */
  const addPieceFile = (entry, filePath) => {
    const normalizedPath = formatArtifactLabel(filePath);
    const tier = resolvePieceTier({ entry, normalizedPath, resolveArtifactTier });
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
    const normalizedEntry = {
      ...entry,
      tier,
      layout: existingLayout,
      path: normalizedPath
    };
    pieceEntries.push(normalizedEntry);

    let targets = pieceEntriesByPath.get(normalizedPath);
    if (!targets) {
      targets = [];
      pieceEntriesByPath.set(normalizedPath, targets);
    }
    targets.push(normalizedEntry);
  };

  /**
   * Attach incremental metadata updates to tracked piece-manifest rows.
   *
   * @param {string} piecePath
   * @param {object} [meta]
   * @returns {void}
   */
  const updatePieceMetadata = (piecePath, meta = {}) => {
    if (typeof piecePath !== 'string' || !piecePath) return;
    const targets = pieceEntriesByPath.get(piecePath);
    if (!targets?.length) return;

    const bytes = Number(meta?.bytes);
    const checksumValue = typeof meta?.checksum === 'string' ? meta.checksum.trim().toLowerCase() : null;
    const checksumAlgo = typeof meta?.checksumAlgo === 'string' ? meta.checksumAlgo.trim().toLowerCase() : null;
    const checksumHash = typeof meta?.checksumHash === 'string' && meta.checksumHash.includes(':')
      ? meta.checksumHash.trim().toLowerCase()
      : null;

    for (const entry of targets) {
      if (Number.isFinite(bytes) && bytes >= 0) entry.bytes = bytes;
      if (checksumValue && checksumAlgo) {
        entry.checksum = `${checksumAlgo}:${checksumValue}`;
      } else if (checksumHash) {
        entry.checksum = checksumHash;
      }
    }
  };

  return {
    pieceEntries,
    formatArtifactLabel,
    addPieceFile,
    updatePieceMetadata
  };
}
