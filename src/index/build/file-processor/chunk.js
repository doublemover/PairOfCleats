export const getStructuralMatchesForChunk = (matches, startLine, endLine, totalLines) => {
  if (!matches || !matches.length) return null;
  const start = Number.isFinite(startLine) ? startLine : 1;
  const end = Number.isFinite(endLine) ? endLine : start;
  const fileEnd = Number.isFinite(totalLines) && totalLines > 0 ? totalLines : end;
  const selected = [];
  for (const match of matches) {
    const matchStart = Number.isFinite(match.startLine) ? match.startLine : 1;
    const matchEnd = Number.isFinite(match.endLine) ? match.endLine : fileEnd;
    if (matchEnd < start || matchStart > end) continue;
    selected.push(match);
  }
  return selected.length ? selected : null;
};

export const assignCommentsToChunks = (comments, chunks) => {
  const assignments = new Map();
  if (!Array.isArray(comments) || !comments.length || !Array.isArray(chunks) || !chunks.length) {
    return assignments;
  }
  let chunkIdx = 0;
  for (const comment of comments) {
    // Chunks are treated as half-open ranges [start, end).
    while (chunkIdx < chunks.length && chunks[chunkIdx].end <= comment.start) {
      chunkIdx += 1;
    }
    const target = chunkIdx < chunks.length ? chunkIdx : chunks.length - 1;
    if (target < 0) continue;
    if (!assignments.has(target)) assignments.set(target, []);
    assignments.get(target).push(comment);
  }
  return assignments;
};

export const applyStructuralMatchesToChunks = (chunks, matches) => {
  if (!matches || !matches.length || !Array.isArray(chunks)) return chunks;
  const totalLines = chunks.reduce((max, chunk) => {
    const endLine = Number(chunk?.endLine) || 0;
    return endLine > max ? endLine : max;
  }, 0) || 1;
  for (const chunk of chunks) {
    if (!chunk) continue;
    const structural = getStructuralMatchesForChunk(
      matches,
      chunk.startLine,
      chunk.endLine,
      totalLines
    );
    if (!structural) continue;
    const docmeta = chunk.docmeta && typeof chunk.docmeta === 'object' ? chunk.docmeta : {};
    chunk.docmeta = { ...docmeta, structural };
  }
  return chunks;
};
