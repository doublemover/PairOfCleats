import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

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
  const matches = [...text.matchAll(/^#{1,6} .+$/gm)];
  return buildChunksFromMatches(text, matches, (raw) => raw.replace(/^#+ /, '').trim());
}
