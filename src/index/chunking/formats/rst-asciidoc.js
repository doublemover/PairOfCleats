import { buildLineIndex } from '../../../shared/lines.js';

const buildChunksFromMatches = (text, matches, titleTransform) => {
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

const buildChunksFromLineHeadings = (text, headings) => {
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

export function chunkAsciiDoc(text) {
  const matches = [...text.matchAll(/^={1,6} .+$/gm)];
  return buildChunksFromMatches(text, matches, (raw) => raw.replace(/^=+ /, '').trim());
}

export function chunkRst(text) {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 1; i < lines.length; ++i) {
    const underline = lines[i].trim();
    if (!underline) continue;
    if (/^([=~^"'#*\\-])\1{2,}$/.test(underline)) {
      const title = lines[i - 1].trim();
      if (title) headings.push({ line: i - 1, title });
    }
  }
  return buildChunksFromLineHeadings(text, headings);
}
