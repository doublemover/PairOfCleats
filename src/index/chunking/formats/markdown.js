import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { buildChunksFromMatches } from '../helpers.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

export function chunkMarkdown(text, ext, context) {
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'markdown',
      ext: ext || '.md',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
  const matches = text.matchAll(/^#{1,6} .+$/gm);
  return buildChunksFromMatches(text, matches, (raw) => raw.replace(/^#+ /, '').trim());
}
