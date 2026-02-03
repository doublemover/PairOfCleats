import { offsetToLine } from '../../../../shared/lines.js';
import { assignChunkUids } from '../../../identity/chunk-uid.js';
import { buildVfsManifestRowsForFile } from '../../../tooling/vfs.js';

const assignSpanIndexes = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length < 2) return;
  const groups = new Map();
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const key = [
      chunk.segment?.segmentId || '',
      chunk.start ?? '',
      chunk.end ?? ''
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ chunk, index: i });
  }
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => {
      const kindCmp = String(a.chunk.kind || '').localeCompare(String(b.chunk.kind || ''));
      if (kindCmp) return kindCmp;
      const nameCmp = String(a.chunk.name || '').localeCompare(String(b.chunk.name || ''));
      if (nameCmp) return nameCmp;
      return a.index - b.index;
    });
    for (let i = 0; i < group.length; i += 1) {
      group[i].chunk.spanIndex = i + 1;
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
    namespaceKey: 'repo',
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
