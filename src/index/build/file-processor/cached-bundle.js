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
  const manifestEntry = cachedEntry ? {
    hash: fileHash || cachedEntry.hash || null,
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    bundle: cachedEntry.bundle || `${sha1(relKey)}.json`
  } : null;
  let fileRelations = cachedBundle.fileRelations || null;
  if (!fileRelations) {
    const sample = cachedBundle.chunks.find((chunk) => chunk?.codeRelations);
    if (sample?.codeRelations) {
      fileRelations = buildFileRelations(sample.codeRelations);
    }
  }
  if (fileRelations?.imports) {
    const importLinks = fileRelations.imports
      .map((i) => allImports[i])
      .filter((x) => !!x)
      .flat();
    fileRelations = { ...fileRelations, importLinks };
  }
  const updatedChunks = cachedBundle.chunks.map((cachedChunk) => {
    const updatedChunk = { ...cachedChunk };
    if (updatedChunk.codeRelations) {
      updatedChunk.codeRelations = stripFileRelations(updatedChunk.codeRelations);
    }
    if (!updatedChunk.metaV2?.chunkId) {
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
