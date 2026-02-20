import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { buildChunksFromLineHeadings } from '../helpers.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

const normalizeConfigTreeSitterChunks = (chunks, format) => chunks.map((chunk) => {
  const rawName = typeof chunk?.name === 'string' ? chunk.name.trim() : '';
  const name = rawName || 'section';
  const existingMeta = chunk?.meta && typeof chunk.meta === 'object' ? chunk.meta : {};
  const rawTitle = typeof existingMeta.title === 'string' ? existingMeta.title.trim() : '';
  return {
    ...chunk,
    name,
    kind: chunk?.kind || 'ConfigSection',
    meta: {
      ...existingMeta,
      format,
      title: rawTitle || name
    }
  };
});

export function chunkIniToml(text, format = 'ini', context) {
  if (format === 'toml' && context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'toml',
      ext: '.toml',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return normalizeConfigTreeSitterChunks(treeChunks, format);
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
