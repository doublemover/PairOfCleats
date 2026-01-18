import { buildTreeSitterChunks } from '../tree-sitter.js';
import { buildTypeScriptChunksFromAst } from './chunks-ast.js';
import { buildTypeScriptChunksFromBabel } from './chunks-babel.js';
import { buildTypeScriptChunksHeuristic } from './chunks-heuristic.js';
import { resolveTypeScriptParser } from './parser.js';

export function buildTypeScriptChunks(text, options = {}) {
  if (options.treeSitter) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: (options.ext || '').toLowerCase() === '.tsx' ? 'tsx' : 'typescript',
      ext: options.ext,
      options: { treeSitter: options.treeSitter, log: options.log }
    });
    if (treeChunks && treeChunks.length) return treeChunks;
  }
  const parser = resolveTypeScriptParser(options);
  if (parser === 'heuristic') return buildTypeScriptChunksHeuristic(text);
  if (parser === 'babel') {
    const babelChunks = buildTypeScriptChunksFromBabel(text, options);
    if (babelChunks && babelChunks.length) return babelChunks;
    return buildTypeScriptChunksHeuristic(text);
  }
  if (parser === 'typescript') {
    const astChunks = buildTypeScriptChunksFromAst(text, options);
    if (astChunks && astChunks.length) return astChunks;
    return buildTypeScriptChunksHeuristic(text);
  }
  const astChunks = buildTypeScriptChunksFromAst(text, options);
  if (astChunks && astChunks.length) return astChunks;
  const babelChunks = buildTypeScriptChunksFromBabel(text, options);
  if (babelChunks && babelChunks.length) return babelChunks;
  return buildTypeScriptChunksHeuristic(text);
}
