import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { buildLineIndex } from '../../../shared/lines.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

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

export function chunkIniToml(text, format = 'ini', context) {
  if (format === 'toml' && context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'toml',
      ext: '.toml',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const match = line.match(/^\s*\[\[?([^\]]+)\]\]?\s*$/);
    if (match) {
      headings.push({ line: i, title: match[1].trim() });
    }
  }
  const chunks = buildChunksFromLineHeadings(text, headings);
  if (chunks) {
    return chunks.map((chunk) => ({
      ...chunk,
      kind: 'ConfigSection',
      meta: { ...chunk.meta, format }
    }));
  }
  return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format } }];
}
