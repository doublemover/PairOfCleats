import { offsetToLine } from '../../../../shared/lines.js';
import { assignChunkUids } from '../../../identity/chunk-uid.js';
import { buildVfsManifestRowsForFile } from '../../../tooling/vfs.js';

const assignSpanIndexes = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length < 2) return;
  const groups = new Map();
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const segmentKey = chunk.segment?.segmentId || '';
    const startKey = chunk.start ?? '';
    const endKey = chunk.end ?? '';
    let byStart = groups.get(segmentKey);
    if (!byStart) {
      byStart = new Map();
      groups.set(segmentKey, byStart);
    }
    let byEnd = byStart.get(startKey);
    if (!byEnd) {
      byEnd = new Map();
      byStart.set(startKey, byEnd);
    }
    let indexes = byEnd.get(endKey);
    if (!indexes) {
      indexes = [];
      byEnd.set(endKey, indexes);
    }
    indexes.push(i);
  }
  for (const byStart of groups.values()) {
    for (const byEnd of byStart.values()) {
      for (const indexes of byEnd.values()) {
        if (indexes.length <= 1) continue;
        indexes.sort((aIndex, bIndex) => {
          const aChunk = chunks[aIndex];
          const bChunk = chunks[bIndex];
          const kindCmp = String(aChunk?.kind || '').localeCompare(String(bChunk?.kind || ''));
          if (kindCmp) return kindCmp;
          const nameCmp = String(aChunk?.name || '').localeCompare(String(bChunk?.name || ''));
          if (nameCmp) return nameCmp;
          return aIndex - bIndex;
        });
        for (let i = 0; i < indexes.length; i += 1) {
          chunks[indexes[i]].spanIndex = i + 1;
        }
      }
    }
  }
};

const buildChunkLineRanges = (chunks, lineIndex) => chunks.map((chunk) => {
  const startLine = chunk.meta?.startLine ?? offsetToLine(lineIndex, chunk.start);
  const endOffset = chunk.end > chunk.start ? chunk.end - 1 : chunk.start;
  let endLine = chunk.meta?.endLine ?? offsetToLine(lineIndex, endOffset);
  if (endLine < startLine) endLine = startLine;
  return { startLine, endLine };
});

export const prepareChunkIds = async ({
  chunks,
  text,
  relKey,
  namespaceKey = 'repo',
  containerExt,
  containerLanguageId,
  lineIndex,
  fileHash,
  fileHashAlgo,
  vfsManifestConcurrency,
  strict,
  log
}) => {
  const chunkLineRanges = buildChunkLineRanges(chunks, lineIndex);
  assignSpanIndexes(chunks);
  await assignChunkUids({
    chunks,
    fileText: text,
    fileRelPath: relKey,
    namespaceKey,
    strict,
    log
  });
  const vfsManifestRows = await buildVfsManifestRowsForFile({
    chunks,
    fileText: text,
    containerPath: relKey,
    containerExt,
    containerLanguageId,
    lineIndex,
    fileHash,
    fileHashAlgo,
    concurrency: vfsManifestConcurrency,
    strict,
    log
  });
  return { chunkLineRanges, vfsManifestRows };
};
