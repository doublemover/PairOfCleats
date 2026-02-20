import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
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

export function chunkXml(text, context) {
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'xml',
      ext: '.xml',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return normalizeConfigTreeSitterChunks(treeChunks, 'xml');
  }
  const keys = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '<') {
      i += 1;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', i) || text.startsWith('<!', i)) {
      const end = text.indexOf('>', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith('</', i)) {
      depth = Math.max(0, depth - 1);
      const end = text.indexOf('>', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    const tagMatch = text.slice(i + 1).match(/^([A-Za-z0-9:_-]+)/);
    if (!tagMatch) {
      i += 1;
      continue;
    }
    const tag = tagMatch[1];
    const closeIdx = text.indexOf('>', i + 1);
    const selfClose = closeIdx >= 0 && text[closeIdx - 1] === '/';
    if (depth === 1) {
      keys.push({ name: tag, index: i });
    }
    if (!selfClose) depth += 1;
    i = closeIdx === -1 ? text.length : closeIdx + 1;
  }
  if (!keys.length) return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'xml' } }];
  const chunks = [];
  for (let k = 0; k < keys.length; ++k) {
    const start = keys[k].index;
    const end = k + 1 < keys.length ? keys[k + 1].index : text.length;
    const title = keys[k].name || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'ConfigSection',
      meta: { title, format: 'xml' }
    });
  }
  return chunks;
}
