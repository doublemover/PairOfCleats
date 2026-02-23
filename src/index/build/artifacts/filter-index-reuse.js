import fsSync from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../../../shared/artifact-io.js';
import { buildSerializedFilterIndex } from './filter-index.js';
import { summarizeFilterIndex, formatBytes } from './helpers.js';

/**
 * Resolve existing artifact path, falling back to `.bak` sibling when present.
 *
 * @param {string|null|undefined} targetPath
 * @returns {string|null}
 */
const resolveExistingOrBakPath = (targetPath) => {
  if (!targetPath) return null;
  if (fsSync.existsSync(targetPath)) return targetPath;
  const bakPath = `${targetPath}.bak`;
  if (fsSync.existsSync(bakPath)) return bakPath;
  return null;
};

/**
 * Validate serialized filter-index shape before reuse.
 *
 * @param {object} candidate
 * @returns {boolean}
 */
export const validateSerializedFilterIndex = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('expected object');
  }
  if (!Number.isFinite(Number(candidate.schemaVersion))) {
    throw new Error('missing schemaVersion');
  }
  if (!Number.isFinite(Number(candidate.fileChargramN))) {
    throw new Error('missing fileChargramN');
  }
  if (!Array.isArray(candidate.fileById)) {
    throw new Error('missing fileById');
  }
  if (!Array.isArray(candidate.fileChunksById)) {
    throw new Error('missing fileChunksById');
  }
  if (candidate.fileById.length !== candidate.fileChunksById.length) {
    throw new Error('fileById/fileChunksById length mismatch');
  }
  if (candidate.byLang == null || typeof candidate.byLang !== 'object') {
    throw new Error('missing byLang');
  }
  return true;
};

/**
 * Resolve previous filter-index metadata from pieces manifest.
 *
 * @param {{outDir:string,maxJsonBytes:number}} input
 * @returns {{piece:object|null,source:string|null}}
 */
const resolvePreviousFilterIndex = ({ outDir, maxJsonBytes }) => {
  const previousPiecesManifestPath = path.join(outDir, 'pieces', 'manifest.json');
  let previousPiecesManifest = null;
  try {
    const source = resolveExistingOrBakPath(previousPiecesManifestPath);
    if (source) {
      previousPiecesManifest = readJsonFile(source, { maxBytes: maxJsonBytes });
    }
  } catch {}
  const previousPieces = Array.isArray(previousPiecesManifest?.pieces) ? previousPiecesManifest.pieces : [];
  const previousFilterIndexPiece = previousPieces.find((piece) => piece?.name === 'filter_index' && piece?.path);
  const previousFilterIndexPath = previousFilterIndexPiece?.path
    ? path.join(outDir, ...String(previousFilterIndexPiece.path).split('/'))
    : null;
  const previousFilterIndexSource = resolveExistingOrBakPath(previousFilterIndexPath);
  return {
    piece: previousFilterIndexPiece || null,
    source: previousFilterIndexSource
  };
};

/**
 * Resolve current filter-index artifact state with validated fallback reuse when
 * the current build fails.
 *
 * @param {{
 *   outDir:string,
 *   maxJsonBytes:number,
 *   maxJsonBytesSoft:number,
 *   state:object,
 *   resolvedConfig:object,
 *   userConfig:object,
 *   root:string,
 *   log:(message:string)=>void
 * }} input
 * @returns {{
 *   filterIndex:object|null,
 *   filterIndexStats:object|null,
 *   filterIndexReused:boolean,
 *   filterIndexFallback:{piece:object,path:string}|null
 * }}
 */
export const resolveFilterIndexArtifactState = ({
  outDir,
  maxJsonBytes,
  maxJsonBytesSoft,
  state,
  resolvedConfig,
  userConfig,
  root,
  log
}) => {
  let filterIndex = null;
  let filterIndexStats = null;
  let filterIndexReused = false;
  let filterIndexFallback = null;
  try {
    filterIndex = buildSerializedFilterIndex({
      chunks: state.chunks,
      resolvedConfig,
      userConfig,
      root
    });
    validateSerializedFilterIndex(filterIndex);
    filterIndexStats = summarizeFilterIndex(filterIndex);
    if (filterIndexStats && typeof filterIndexStats === 'object' && Number.isFinite(filterIndexStats.jsonBytes)) {
      // filter_index is currently written uncompressed (compressible=false); keep a stable estimate
      // in case later phases make it compressible.
      filterIndexStats.diskBytesEstimate = filterIndexStats.jsonBytes;
      filterIndexStats.compressionRatioEstimate = 1;
    }
    if (filterIndexStats?.jsonBytes && filterIndexStats.jsonBytes > maxJsonBytesSoft) {
      log(
        `filter_index ~${formatBytes(filterIndexStats.jsonBytes)}; ` +
        'large filter indexes increase memory usage (consider sqlite for large repos).'
      );
    }
  } catch (err) {
    const message = err?.message || String(err);
    log(`[warn] [filter_index] build failed; skipping. (${message})`);
    filterIndex = null;
    filterIndexStats = null;
    const previous = resolvePreviousFilterIndex({ outDir, maxJsonBytes });
    const previousFilterIndexSource = previous?.source || null;
    const previousFilterIndexPiece = previous?.piece || null;
    if (previousFilterIndexSource) {
      const note = message ? ` (${message})` : '';
      log(`[warn] [filter_index] build skipped; reusing previous artifact.${note}`);
      try {
        const previousRaw = readJsonFile(previousFilterIndexSource, { maxBytes: maxJsonBytes });
        validateSerializedFilterIndex(previousRaw);
        filterIndexReused = true;
        filterIndexFallback = {
          piece: {
            type: previousFilterIndexPiece?.type || 'chunks',
            name: 'filter_index',
            format: previousFilterIndexPiece?.format || 'json'
          },
          path: previousFilterIndexSource
        };
        try {
          filterIndexStats = summarizeFilterIndex(previousRaw);
        } catch {
          filterIndexStats = { reused: true };
        }
        if (filterIndexStats && typeof filterIndexStats === 'object') {
          filterIndexStats.reused = true;
        }
      } catch (reuseErr) {
        const reuseMessage = reuseErr?.message || String(reuseErr);
        log(`[warn] [filter_index] failed to reuse previous artifact; validation failed. (${reuseMessage})`);
      }
    }
  }
  return {
    filterIndex,
    filterIndexStats,
    filterIndexReused,
    filterIndexFallback
  };
};
