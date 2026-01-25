import { collectPythonImports } from './imports.js';

/**
 * Build import/export/call/usage relations for Python chunks.
 * @param {string} text
 * @param {object|null} pythonAst
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[]}}
 */
export function buildPythonRelations(text, pythonAst) {
  let imports = [];
  let usages = [];
  let calls = [];
  let callDetails = [];
  let exports = [];
  if (pythonAst) {
    imports = Array.isArray(pythonAst.imports) ? pythonAst.imports : [];
    usages = Array.isArray(pythonAst.usages) ? pythonAst.usages : [];
    calls = Array.isArray(pythonAst.calls) ? pythonAst.calls : [];
    callDetails = Array.isArray(pythonAst.callDetails) ? pythonAst.callDetails : [];
    exports = Array.isArray(pythonAst.exports) ? pythonAst.exports : [];
  } else {
    const fallback = collectPythonImports(text);
    imports = fallback.imports;
    usages = fallback.usages;
  }
  return {
    imports,
    exports,
    calls,
    callDetails,
    usages
  };
}
