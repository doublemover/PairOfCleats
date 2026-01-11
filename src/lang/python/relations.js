import { collectPythonImports } from './imports.js';

/**
 * Build import/export/call/usage relations for Python chunks.
 * @param {string} text
 * @param {Record<string,string[]>} allImports
 * @param {object|null} pythonAst
 * @returns {{imports:string[],exports:string[],calls:Array<[string,string]>,usages:string[],importLinks:string[]}}
 */
export function buildPythonRelations(text, allImports, pythonAst) {
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
  const importLinks = imports
    .map((i) => allImports[i])
    .filter((x) => !!x)
    .flat();
  return {
    imports,
    exports,
    calls,
    callDetails,
    usages,
    importLinks
  };
}
