import { sha1 } from '../../../shared/hash.js';
import { buildMetaV2 } from '../../metadata-v2.js';
import { applyStructuralMatchesToChunks } from './chunk.js';
import { pickMinLimit, resolveFileCaps } from './read.js';
import { stripFileRelations } from './relations.js';
import { log } from '../../../shared/progress.js';
import { buildPostingsPayloadMetadata } from '../postings-payload.js';

/**
 * Rehydrate a cached per-file bundle when structural and cap invariants still
 * hold for the current file snapshot.
 * Rebuilds metadata as needed, reapplies structural matches, and returns
 * skip metadata when cache reuse is disallowed by size/line limits.
 *
 * @param {object} input
 * @returns {{result:object|null,skip:object|null}}
 */
export function reuseCachedBundle({
  abs,
  relKey,
  fileIndex,
  fileStat,
  fileHash,
  fileHashAlgo,
  ext,
  fileCaps,
  maxFileBytes = null,
  cachedBundle,
  incrementalState,
  fileStructural,
  toolInfo,
  analysisPolicy,
  fileStart,
  knownLines,
  fileLanguageId,
  mode = null
}) {
  if (!cachedBundle || !Array.isArray(cachedBundle.chunks)) return { result: null, skip: null };
  const hasValidChunks = cachedBundle.chunks.every((chunk) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    return Number.isFinite(start) && Number.isFinite(end) && start <= end;
  });
  if (!hasValidChunks) return { result: null, skip: null };
  const hasIdentityFields = cachedBundle.chunks.every((chunk) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const meta = chunk.metaV2 || null;
    const chunkUid = meta?.chunkUid || chunk.chunkUid;
    const virtualPath = meta?.virtualPath || chunk.virtualPath || chunk.segment?.virtualPath;
    if (!chunkUid || !virtualPath) return false;
    const segment = chunk.segment || meta?.segment || null;
    if (segment && !segment.segmentUid) return false;
    return true;
  });
  if (!hasIdentityFields) return { result: null, skip: null };
  if (mode === 'code' && !Array.isArray(cachedBundle.vfsManifestRows)) {
    return { result: null, skip: null };
  }
  const cachedCaps = resolveFileCaps(fileCaps, ext, fileLanguageId, mode);
  const effectiveMaxBytes = pickMinLimit(maxFileBytes, cachedCaps.maxBytes);
  if (effectiveMaxBytes && fileStat.size > effectiveMaxBytes) {
    return {
      result: null,
      skip: {
        reason: 'oversize',
        stage: 'cached-reuse',
        capSource: 'maxBytes',
        bytes: fileStat.size,
        maxBytes: effectiveMaxBytes
      }
    };
  }
  if (cachedCaps.maxLines) {
    const maxLine = cachedBundle.chunks.reduce((max, chunk) => {
      const endLine = Number(chunk?.endLine) || 0;
      return endLine > max ? endLine : max;
    }, 0);
    if (maxLine > cachedCaps.maxLines) {
      return {
        result: null,
        skip: {
          reason: 'oversize',
          stage: 'cached-reuse',
          capSource: 'maxLines',
          lines: maxLine,
          maxLines: cachedCaps.maxLines
        }
      };
    }
  }
  const cachedEntry = incrementalState.manifest?.files?.[relKey] || null;
  const resolvedHash = fileHash || cachedEntry?.hash || null;
  const resolvedHashAlgo = fileHashAlgo || cachedEntry?.hashAlgo || null;
  const resolvedEncoding = cachedBundle.encoding || cachedEntry?.encoding || null;
  const resolvedEncodingFallback = typeof cachedBundle.encodingFallback === 'boolean'
    ? cachedBundle.encodingFallback
    : (typeof cachedEntry?.encodingFallback === 'boolean' ? cachedEntry.encodingFallback : null);
  const resolvedEncodingConfidence = Number.isFinite(cachedBundle.encodingConfidence)
    ? cachedBundle.encodingConfidence
    : (Number.isFinite(cachedEntry?.encodingConfidence) ? cachedEntry.encodingConfidence : null);
  const fileInfo = {
    size: fileStat.size,
    hash: resolvedHash,
    hashAlgo: resolvedHashAlgo,
    encoding: resolvedEncoding,
    encodingFallback: resolvedEncodingFallback,
    encodingConfidence: resolvedEncodingConfidence
  };
  const manifestEntry = cachedEntry ? {
    hash: resolvedHash,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    bundle: cachedEntry.bundle || `${sha1(relKey)}.json`,
    encoding: resolvedEncoding,
    encodingFallback: resolvedEncodingFallback,
    encodingConfidence: resolvedEncodingConfidence
  } : null;
  const fileRelations = cachedBundle.fileRelations || null;
  if (!fileRelations) return { result: null, skip: null };
  const vfsManifestRows = Array.isArray(cachedBundle.vfsManifestRows)
    ? cachedBundle.vfsManifestRows
    : null;
  const updatedChunks = cachedBundle.chunks.map((cachedChunk) => {
    const updatedChunk = { ...cachedChunk };
    if (!updatedChunk.fileHash && fileHash) updatedChunk.fileHash = fileHash;
    if (!updatedChunk.fileHashAlgo && fileHashAlgo) updatedChunk.fileHashAlgo = fileHashAlgo;
    if (updatedChunk.codeRelations) {
      updatedChunk.codeRelations = stripFileRelations(updatedChunk.codeRelations);
    }
    const metaNeedsHash = fileHash && !updatedChunk.metaV2?.fileHash;
    const metaModifiers = updatedChunk.metaV2?.modifiers;
    const metaNeedsNormalize = metaModifiers && !Array.isArray(metaModifiers);
    if (!updatedChunk.metaV2?.chunkId || metaNeedsHash || metaNeedsNormalize) {
      updatedChunk.metaV2 = buildMetaV2({
        chunk: updatedChunk,
        docmeta: updatedChunk.docmeta,
        toolInfo,
        analysisPolicy
      });
      if (analysisPolicy?.metadata?.enabled !== false && !updatedChunk.metaV2) {
        log(
          `[metaV2] missing metadata for cached chunk ${relKey} ` +
          `(${updatedChunk.start}-${updatedChunk.end})`
        );
      }
    }
    return updatedChunk;
  });
  applyStructuralMatchesToChunks(updatedChunks, fileStructural);
  const fileDurationMs = Date.now() - fileStart;
  const cachedLanguage = updatedChunks.find((chunk) => chunk?.lang)?.lang || null;
  const cachedLines = updatedChunks.reduce((max, chunk) => {
    const endLine = Number(chunk?.endLine) || 0;
    return endLine > max ? endLine : max;
  }, 0);
  return {
    skip: null,
    result: {
      abs,
      relKey,
      fileIndex,
      cached: true,
      durationMs: fileDurationMs,
      chunks: updatedChunks,
      vfsManifestRows,
      manifestEntry,
      fileInfo,
      fileRelations,
      postingsPayload: buildPostingsPayloadMetadata({
        chunks: updatedChunks,
        fileRelations,
        vfsManifestRows
      }),
      fileMetrics: {
        languageId: fileLanguageId || cachedLanguage || null,
        bytes: fileStat.size,
        lines: cachedLines || (Number.isFinite(knownLines) ? knownLines : 0),
        durationMs: fileDurationMs,
        parseMs: 0,
        tokenizeMs: 0,
        enrichMs: 0,
        embeddingMs: 0,
        cached: true
      }
    }
  };
}
