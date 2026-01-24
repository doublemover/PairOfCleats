const createLineReader = (text, lineIndex) => {
  const totalLines = lineIndex.length || 1;
  const clampLine = (value) => Math.max(1, Math.min(totalLines, Number(value) || 1));
  const getLine = (lineNumber) => {
    const line = clampLine(lineNumber);
    const start = lineIndex[line - 1] ?? 0;
    const end = lineIndex[line] ?? text.length;
    let value = text.slice(start, end);
    if (value.endsWith('\n')) value = value.slice(0, -1);
    if (value.endsWith('\r')) value = value.slice(0, -1);
    return value;
  };
  const getLines = (startLine, endLine) => {
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return [];
    const start = clampLine(startLine);
    const end = clampLine(endLine);
    if (end < start) return [];
    const output = new Array(end - start + 1);
    for (let line = start, idx = 0; line <= end; line += 1, idx += 1) {
      output[idx] = getLine(line);
    }
    return output;
  };
  return { getLines, totalLines };
};

const stripCommentText = (chunkText, chunkStart, comments) => {
  if (!Array.isArray(comments) || comments.length === 0) return chunkText;
  const ranges = comments
    .map((comment) => ({
      start: Math.max(0, Number(comment.start) - chunkStart),
      end: Math.min(chunkText.length, Number(comment.end) - chunkStart)
    }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!ranges.length) return chunkText;
  const merged = [];
  let current = ranges[0];
  for (let i = 1; i < ranges.length; i += 1) {
    const next = ranges[i];
    if (next.start <= current.end) {
      current = { start: current.start, end: Math.max(current.end, next.end) };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  let cursor = 0;
  let output = '';
  for (const range of merged) {
    if (range.start > cursor) output += chunkText.slice(cursor, range.start);
    const slice = chunkText.slice(range.start, range.end);
    output += slice.replace(/[^\r\n]/g, ' ');
    cursor = range.end;
  }
  if (cursor < chunkText.length) output += chunkText.slice(cursor);
  return output;
};

export { createLineReader, stripCommentText };
