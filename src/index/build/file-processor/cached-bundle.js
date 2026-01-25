import { sha1 } from '../../../shared/hash.js';
import { buildMetaV2 } from '../../metadata-v2.js';
import { applyStructuralMatchesToChunks } from './chunk.js';
import { resolveFileCaps } from './read.js';
import { stripFileRelations } from './relations.js';

export function reuseCachedBundle({
  abs,
  relKey,
  fileIndex,
  fileStat,
  fileHash,
  fileHashAlgo,
  ext,
  fileCaps,
  cachedBundle,
  incrementalState,
  fileStructural,
  toolInfo,
  analysisPolicy,
  fileStart,
  knownLines,
  fileLanguageId
}) {
  if (!cachedBundle || !Array.isArray(cachedBundle.chunks)) return { result: null, skip: null };
  const hasValidChunks = cachedBundle.chunks.every((chunk) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const start = Number(chunk.start);
    const end = Number(chunk.end);
    return Number.isFinite(start) && Number.isFinite(end) && start <= end;
  });
  if (!hasValidChunks) return { result: null, skip: null };
  const cachedCaps = resolveFileCaps(fileCaps, ext);
  if (cachedCaps.maxLines) {
    const maxLine = cachedBundle.chunks.reduce((max, chunk) => {
      const endLine = Number(chunk?.endLine) || 0;
      return endLine > max ? endLine : max;
    }, 0);
    if (maxLine > cachedCaps.maxLines) {
      return { result: null, skip: { reason: 'oversize', lines: maxLine, maxLines: cachedCaps.maxLines } };
    }
  }
  const cachedEntry = incrementalState.manifest?.files?.[relKey] || null;
  const resolvedHash = fileHash || cachedEntry?.hash || null;
  const resolvedHashAlgo = fileHashAlgo || cachedEntry?.hashAlgo || null;
  const fileInfo = {
    size: fileStat.size,
    hash: resolvedHash,
    hashAlgo: resolvedHashAlgo
  };
  const manifestEntry = cachedEntry ? {
    hash: resolvedHash,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    bundle: cachedEntry.bundle || `${sha1(relKey)}.json`
  } : null;
  const fileRelations = cachedBundle.fileRelations || null;
  if (!fileRelations) return { result: null, skip: null };
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
      manifestEntry,
      fileInfo,
      fileRelations,
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
