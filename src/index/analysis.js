import esprima from 'esprima';
import escomplexCore from 'escomplex/src/core.js';
import escomplexWalker from 'escomplex/src/walker.js';
import escomplexSyntax from 'escomplex/src/syntax/index.js';
import { lintFile } from './lint-runtime.js';
export { lintFile } from './lint-runtime.js';

/**
 * Compute basic cyclomatic complexity metrics for JS code.
 * @param {string} code
 * @returns {Promise<{functions:number,averageCyclomatic:number}|{}>}
 */
export const COMPLEXITY_ANALYZER_VERSION = '2';

export async function analyzeComplexity(code) {
  try {
    let ast;
    try { ast = esprima.parseScript(code, { loc: true }); }
    catch { ast = esprima.parseModule(code, { loc: true }); }
    const supported = escomplexSyntax.get({});
    const unsupported = new Set();
    // Module linkage contributes no executable branch. Preserve declaration
    // ASTs/locations beneath export wrappers; never edit or strip source text.
    const project = node => {
      if (!node || typeof node !== 'object') return node;
      if (node instanceof RegExp) return node;
      if (Array.isArray(node)) return node.map(project).filter(value => value != null);
      if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return null;
      if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
        const declaration = project(node.declaration);
        if (!declaration) return null;
        if (declaration.type.endsWith('Declaration')) return declaration;
        return { type: 'ExpressionStatement', expression: declaration, loc: node.loc };
      }
      if (node.type && node.type !== 'Program' && !supported[node.type]) unsupported.add(node.type);
      const result = {};
      for (const [key, value] of Object.entries(node)) result[key] = key === 'loc' ? value : project(value);
      return result;
    };
    const compatibleAst = project(ast);
    if (unsupported.size) return { status: 'unavailable', reason: 'unsupported_syntax',
      unsupportedKinds: [...unsupported].sort(), analyzerVersion: COMPLEXITY_ANALYZER_VERSION };
    const report = escomplexCore.analyse(compatibleAst, escomplexWalker);
    const values = report?.functions?.map(row => row.cyclomatic);
    if (!values || values.some(value => !Number.isFinite(value))) throw new Error('Invalid complexity report');
    return { status: 'measured', analyzerVersion: COMPLEXITY_ANALYZER_VERSION,
      functions: values.length, averageCyclomatic: values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
  } catch {
    return { status: 'unavailable', reason: 'parse_or_analysis_failed', analyzerVersion: COMPLEXITY_ANALYZER_VERSION };
  }
}

/**
 * Run ESLint on a code chunk and return lint messages.
 * @param {string} text
 * @param {string} relPath
 * @param {{root:string,policy?:object,signal?:AbortSignal,enabled?:boolean}} options
 * @returns {Promise<Array<{message:string}>>}
 */
export async function lintChunk(text, relPath, options) {
  return (await lintFile(text, relPath, options)).messages;
}
