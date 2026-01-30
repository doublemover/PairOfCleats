export const attachCallDetailsByChunkIndex = (callIndex, chunks) => {
  if (!callIndex?.callDetailsWithRange?.length) return;
  const callDetailsByChunkIndex = new Map();
  const chunkRanges = chunks
    .map((chunk, index) => ({
      index,
      start: Number.isFinite(chunk?.start) ? chunk.start : null,
      end: Number.isFinite(chunk?.end) ? chunk.end : null,
      span: Number.isFinite(chunk?.start) && Number.isFinite(chunk?.end)
        ? Math.max(0, chunk.end - chunk.start)
        : null
    }))
    .filter((entry) => Number.isFinite(entry.start) && Number.isFinite(entry.end));
  for (const detail of callIndex.callDetailsWithRange) {
    if (!Number.isFinite(detail?.start) || !Number.isFinite(detail?.end)) continue;
    let best = null;
    for (const chunk of chunkRanges) {
      if (detail.start < chunk.start || detail.end > chunk.end) continue;
      if (!best || chunk.span < best.span) best = chunk;
    }
    if (!best) continue;
    const list = callDetailsByChunkIndex.get(best.index) || [];
    list.push(detail);
    callDetailsByChunkIndex.set(best.index, list);
  }
  callIndex.callDetailsByChunkIndex = callDetailsByChunkIndex;
};
