import { attachImportExtraction, createImportExtraction } from '../../shared/import-extraction.js';
import { getJavaScriptSyntaxIdentity, ownsJavaScriptSyntaxText } from './parse.js';

/** Both existing AST traversals own literal dependencies from the same syntax
 * snapshot. Keep that producer receipt beside persisted relation arrays, not
 * only in the standalone collector's private array association. */
export const createJavaScriptImportResult = ({ entries, text, ast, signal = null }) => {
  const identity = getJavaScriptSyntaxIdentity(ast), owned = ownsJavaScriptSyntaxText(ast, text);
  const receipt = createImportExtraction({ entries, text: typeof text === 'string' ? text : null,
    producerId: 'javascript-literal-imports',
    parser: identity ? { id: 'javascript-' + identity.family, version: identity.version, available: true } : null,
    parserCoverage: 'partial', scope: 'javascript-literal-import-export-require-specifiers',
    state: ast && !owned ? 'unqualified' : null,
    reasons: signal?.aborted ? ['cancelled'] : !ast ? ['parse-failed'] : !owned ? ['source_parser_unqualified']
      : ast.errors?.length ? ['parse-recovered'] : [] });
  return { entries: attachImportExtraction(entries, receipt), receipt };
};
