import { buildConfigTreeSitterChunks } from './config-tree-sitter.js';
import { buildChunksFromLineHeadings } from '../helpers.js';

export function chunkIniToml(text, format = 'ini', context) {
  const treeChunks = buildConfigTreeSitterChunks({
    text,
    context,
    languageId: 'toml',
    ext: '.toml',
    format,
    enabled: format === 'toml'
  });
  if (treeChunks) return treeChunks;
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
