import { getJavaScriptSyntaxIdentity, ownsJavaScriptSyntaxText, parseJavaScriptAst } from './parse.js';
import { attachImportExtraction, createImportExtraction } from '../../shared/import-extraction.js';

const WALK_SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'tokens',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
  'parent',
  'errors'
]);

/**
 * Collect import/require dependencies from JS AST.
 * @param {object} ast
 * @returns {string[]}
 */
export function collectImportsFromAst(ast) {
  const imports = new Set();

  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        stack.push(node[i]);
      }
      continue;
    }
    if (typeof node !== 'object') continue;

    if (node.type === 'ImportDeclaration') {
      if (node.source && node.source.value) imports.add(node.source.value);
    }
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration')
      && node.source && node.source.value) {
      imports.add(node.source.value);
    }
    if (node.type === 'TSImportEqualsDeclaration') {
      const value = node.moduleReference?.expression?.value;
      if (typeof value === 'string') imports.add(value);
    }
    if (node.type === 'ImportExpression' && node.source) {
      const sourceValue = node.source.value;
      if (typeof sourceValue === 'string') imports.add(sourceValue);
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
      const arg = node.arguments?.[0];
      const value = arg && (arg.value ?? null);
      if (typeof value === 'string') imports.add(value);
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier'
      && node.callee.name === 'require') {
      const arg = node.arguments?.[0];
      if (arg && typeof arg.value === 'string') {
        imports.add(arg.value);
      }
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (WALK_SKIP_KEYS.has(key)) continue;
      const child = node[key];
      if (child && typeof child === 'object') {
        stack.push(child);
      }
    }
  }
  return Array.from(imports);
}

/**
 * Collect import/require dependencies from JS source.
 * @param {string} text
 * @param {object} [options]
 * @returns {string[]}
 */
export function collectImports(text, options = {}) {
  const signal = options.abortSignal || options.signal;
  const ast = signal?.aborted ? null : options.ast || parseJavaScriptAst(text, options);
  const imports = ast ? collectImportsFromAst(ast) : [];
  const identity = getJavaScriptSyntaxIdentity(ast);
  const owned = ownsJavaScriptSyntaxText(ast, text);
  // Literal dependencies are a declared syntax subset, not a claim about
  // constructed runtime imports. An injected/stale AST or recovered parse
  // cannot qualify an empty result or a reusable source observation.
  return attachImportExtraction(imports, createImportExtraction({ entries: imports,
    text: typeof text === 'string' ? text : null, producerId: 'javascript-literal-imports',
    parser: identity ? { id: 'javascript-' + identity.family, version: identity.version, available: true } : null,
    parserCoverage: 'partial', scope: 'javascript-literal-import-export-require-specifiers',
    state: ast && !owned ? 'unqualified' : null,
    reasons: signal?.aborted ? ['cancelled'] : !ast ? ['parse-failed'] : !owned ? ['source_parser_unqualified'] : ast.errors?.length ? ['parse-recovered'] : [] }));
}
