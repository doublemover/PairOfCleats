import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { buildChunksFromLineHeadings } from '../helpers.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

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
