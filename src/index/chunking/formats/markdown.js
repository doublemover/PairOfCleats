import { createRequire } from 'node:module';
import { deferLanguageFunctions } from '../../deferred-language-functions.js';
import { buildChunksFromMatches } from '../helpers.js';
import { getTreeSitterOptions } from '../tree-sitter.js';
const require = createRequire(import.meta.url);
const { buildTreeSitterChunks } = deferLanguageFunctions(
  () => require('../../../lang/tree-sitter.js'),
  ['buildTreeSitterChunks']
);

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
