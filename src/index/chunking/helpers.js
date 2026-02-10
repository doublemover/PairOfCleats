import { buildLineIndex } from '../../shared/lines.js';

export const buildChunksFromLineHeadings = (text, headings) => {
  if (!headings.length) return null;
  const lineIndex = buildLineIndex(text);
  const chunks = [];
  for (let i = 0; i < headings.length; ++i) {
    const startLine = headings[i].line;
    const endLine = i + 1 < headings.length ? headings[i + 1].line : lineIndex.length;
    const start = lineIndex[startLine] || 0;
    const end = endLine < lineIndex.length ? lineIndex[endLine] : text.length;
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
  for (let i = 0; i < matches.length; ++i) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const rawTitle = matches[i][0];
    const title = titleTransform ? titleTransform(rawTitle) : rawTitle.trim();
    chunks.push({
      start,
      end,
      name: title || 'section',
      kind: 'Section',
      meta: { title }
    });
  }
  return chunks.length ? chunks : null;
};
