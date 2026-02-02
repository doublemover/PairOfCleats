export const buildLineAuthors = (annotateResult) => {
  const lines = Array.isArray(annotateResult?.lines) ? annotateResult.lines : [];
  if (!lines.length) return null;
  let maxLine = 0;
  for (const entry of lines) {
    const line = Number(entry?.line);
    if (Number.isFinite(line) && line > maxLine) maxLine = line;
  }
  if (!maxLine) return null;
  const authors = new Array(maxLine).fill(null);
  for (const entry of lines) {
    const line = Number(entry?.line);
    if (!Number.isFinite(line) || line < 1) continue;
    const author = entry?.author ? String(entry.author) : 'unknown';
    authors[line - 1] = author;
  }
  for (let i = 0; i < authors.length; i += 1) {
    if (!authors[i]) authors[i] = 'unknown';
  }
  return authors;
};

export const getChunkAuthorsFromLines = (lineAuthors, startLine, endLine) => {
  if (!Array.isArray(lineAuthors) || !lineAuthors.length) return [];
  const start = Math.max(1, Number.parseInt(startLine, 10) || 1);
  const end = Math.max(start, Number.parseInt(endLine, 10) || start);
  const authors = new Set();
  for (let i = start; i <= end && i <= lineAuthors.length; i += 1) {
    const author = lineAuthors[i - 1];
    if (author) authors.add(author);
  }
  return Array.from(authors);
};
