import { createRequire } from 'node:module';
import { getParserCommentOccurrences, ownsCommentOccurrenceSource } from '../lang/comment-occurrences.js';

const require = createRequire(import.meta.url);
const javascript = new Set(['javascript', 'jsx']);
const typescript = new Set(['typescript', 'tsx']);
const extensions = { '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx', '.rs': 'rust' };
const family = language => javascript.has(language) ? 'javascript' : typescript.has(language) ? 'typescript' : language === 'rust' ? 'rust' : null;

/** Reuse the admitted source AST; standalone callers lazily use its same parser.
 * Other languages retain explicitly heuristic legacy coverage, never exactness.
 */
export const resolveCommentOccurrences = ({ text, ext, languageId, context = null, commentOccurrences = null }) => {
  const language = languageId || extensions[ext], selectedFamily = family(language);
  if (!selectedFamily) return { product: null, reason: 'language-comment-adapter-unavailable' };
  if (commentOccurrences) {
    if (!ownsCommentOccurrenceSource(commentOccurrences, text) || family(commentOccurrences.language) !== selectedFamily
      || commentOccurrences.dialect !== (ext || '')) return { product: null, reason: 'comment-source-or-dialect-mismatch' };
    return { product: commentOccurrences, reason: commentOccurrences.reason };
  }
  if (selectedFamily === 'rust') {
    const product = require('../lang/rust-comments.js').parseRustCommentOccurrences(text, { ext });
    return { product, reason: product.reason };
  }
  const supplied = selectedFamily === 'javascript' ? context?.jsAst : context?.exportAst;
  if (supplied) {
    const product = getParserCommentOccurrences(supplied, text);
    if (product && family(product.language) === selectedFamily && product.dialect === (ext || '')) return { product, reason: product.reason };
    return { product: null, reason: 'comment-source-or-dialect-mismatch' };
  }
  if (text.length > 8 * 1024 * 1024) return { product: null, reason: 'standalone-comment-parser-source-budget' };
  const ast = selectedFamily === 'javascript'
    ? require('../lang/javascript/parse.js').parseJavaScriptAst(text, { ext })
    : require('../lang/typescript/syntax-context.js').prepareTypeScriptBabelSyntax(text, { ext });
  const product = ast ? getParserCommentOccurrences(ast, text) : null;
  return { product, reason: product?.reason || (product ? null : 'source-parser-unavailable') };
};
