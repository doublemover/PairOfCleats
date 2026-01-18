import { sha1 } from '../../../shared/hash.js';
import { buildMetaV2 } from '../../metadata-v2.js';
import { applyStructuralMatchesToChunks } from './chunk.js';
import { resolveFileCaps } from './read.js';
import { buildFileRelations, stripFileRelations } from './relations.js';

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
  allImports,
  fileStructural,
  toolInfo,
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
  const fileInfo = {
    size: fileStat.size,
    hash: resolvedHash,
    hashAlgo: resolvedHash ? 'sha1' : null
  };
  const manifestEntry = cachedEntry ? {
    hash: resolvedHash,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    bundle: cachedEntry.bundle || `${sha1(relKey)}.json`
  } : null;
  const normalizeImportLinks = (imports) => {
    if (!Array.isArray(imports)) return null;
    const links = imports
      .map((i) => allImports?.[i])
      .filter(Array.isArray)
      .flat()
      .filter((entry) => entry && entry !== relKey);
    if (!links.length) return [];
    return Array.from(new Set(links));
  };
  let fileRelations = cachedBundle.fileRelations || null;
  if (!fileRelations) {
    const sample = cachedBundle.chunks.find((chunk) => chunk?.codeRelations);
    if (sample?.codeRelations) {
      fileRelations = buildFileRelations(sample.codeRelations, relKey);
    }
  }
  if (fileRelations && typeof fileRelations === 'object') {
    const importLinks = normalizeImportLinks(fileRelations.imports);
    if (importLinks) {
      fileRelations = { ...fileRelations, importLinks };
    }
  }
  const updatedChunks = cachedBundle.chunks.map((cachedChunk) => {
    const updatedChunk = { ...cachedChunk };
    if (!updatedChunk.fileHash && fileHash) updatedChunk.fileHash = fileHash;
    if (!updatedChunk.fileHashAlgo && fileHashAlgo) updatedChunk.fileHashAlgo = fileHashAlgo;
    if (updatedChunk.codeRelations) {
      updatedChunk.codeRelations = stripFileRelations(updatedChunk.codeRelations);
    }
    const metaNeedsHash = fileHash && !updatedChunk.metaV2?.fileHash;
    if (!updatedChunk.metaV2?.chunkId || metaNeedsHash) {
      updatedChunk.metaV2 = buildMetaV2({
        chunk: updatedChunk,
        docmeta: updatedChunk.docmeta,
        toolInfo
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
