import { parseJavaScriptAst } from './parse.js';

/**
 * Collect import/require dependencies from JS AST.
 * @param {object} ast
 * @returns {string[]}
 */
export function collectImportsFromAst(ast) {
  const imports = new Set();
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
    'parent'
  ]);

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
    const keys = Object.keys(node);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const key = keys[i];
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
  const ast = options.ast || parseJavaScriptAst(text, options);
  if (!ast) return [];
  return collectImportsFromAst(ast);
}
