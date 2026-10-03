import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

export const normalizeConfigTreeSitterChunks = (chunks, format) => chunks.map((chunk) => {
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

export const buildConfigTreeSitterChunks = ({
  text,
  context,
  languageId,
  ext,
  format,
  enabled = true
}) => {
  if (enabled !== true || context?.treeSitter?.configChunking !== true) return null;
  const treeChunks = buildTreeSitterChunks({
    text,
    languageId,
    ext,
    options: getTreeSitterOptions(context)
  });
  return treeChunks && treeChunks.length
    ? normalizeConfigTreeSitterChunks(treeChunks, format)
    : null;
};
