import { parseJavaScriptAst } from './parse.js';

/**
 * Collect import/require dependencies from JS AST.
 * @param {object} ast
 * @returns {string[]}
 */
export function collectImportsFromAst(ast) {
  const imports = new Set();
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object') return;

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
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (child && typeof child === 'object') walk(child);
    }
  };

  walk(ast);
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
