import { buildChunksFromLineHeadings, buildChunksFromMatches } from '../helpers.js';

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
