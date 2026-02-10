import { buildLineIndex } from '../../shared/lines.js';

export const buildLineIndexFromLines = (lines) => {
  if (!Array.isArray(lines) || !lines.length) return [0];
  const lineIndex = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    lineIndex[i] = offset;
    offset += lines[i].length + 1;
  }
  return lineIndex;
};

export const buildChunksFromLineHeadings = (text, headings, lineIndex = null) => {
  if (!headings.length) return null;
  const resolvedLineIndex = Array.isArray(lineIndex) && lineIndex.length
    ? lineIndex
    : buildLineIndex(text);
  const chunks = [];
  for (let i = 0; i < headings.length; ++i) {
    const startLine = headings[i].line;
    const endLine = i + 1 < headings.length ? headings[i + 1].line : resolvedLineIndex.length;
    const start = resolvedLineIndex[startLine] || 0;
    const end = endLine < resolvedLineIndex.length ? resolvedLineIndex[endLine] : text.length;
    const title = headings[i].title || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'Section',
      meta: { title }
    });
  }
  return chunks;
};

export const buildChunksFromMatches = (text, matches, titleTransform) => {
  const chunks = [];
  let previous = null;
  for (const match of matches || []) {
    if (previous) {
      const rawTitle = previous[0];
      const title = titleTransform ? titleTransform(rawTitle) : rawTitle.trim();
      chunks.push({
        start: previous.index,
        end: match.index,
        name: title || 'section',
        kind: 'Section',
        meta: { title }
      });
    }
    previous = match;
  }
  if (previous) {
    const rawTitle = previous[0];
    const title = titleTransform ? titleTransform(rawTitle) : rawTitle.trim();
    chunks.push({
      start: previous.index,
      end: text.length,
      name: title || 'section',
      kind: 'Section',
      meta: { title }
    });
  }
  return chunks.length ? chunks : null;
};
