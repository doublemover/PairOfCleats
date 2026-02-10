import { buildLineIndex, lineColToOffset, offsetToLine } from './normalize.js';

/**
 * Build chunk metadata from Python AST metadata.
 * Returns null when AST data is missing.
 * @param {string} text
 * @param {object} astData
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildPythonChunksFromAst(text, astData) {
  if (!astData || !Array.isArray(astData.defs) || !astData.defs.length) return null;
  const lineIndex = buildLineIndex(text);
  const defs = astData.defs
    .filter((def) => Number.isFinite(def.startLine))
    .map((def) => ({
      ...def,
      start: lineColToOffset(lineIndex, def.startLine, def.startCol)
    }))
    .sort((a, b) => a.start - b.start);
  if (!defs.length) return null;

  const chunks = [];
  for (let i = 0; i < defs.length; i++) {
    const current = defs[i];
    const next = defs[i + 1];
    let end = null;
    if (Number.isFinite(current.endLine)) {
      end = lineColToOffset(lineIndex, current.endLine, current.endCol || 0);
    }
    if (!end || end <= current.start) {
      end = next ? next.start : text.length;
    }
    const endLine = offsetToLine(lineIndex, Math.max(current.start, end - 1));
    chunks.push({
      start: current.start,
      end,
      name: current.name,
      kind: current.kind || 'FunctionDeclaration',
      meta: {
        startLine: current.startLine,
        endLine,
        decorators: current.decorators || [],
        signature: current.signature || null,
        params: current.params || [],
        returnType: current.returnType || current.returns || null,
        returnsValue: current.returnsValue || false,
        paramTypes: current.paramTypes || {},
        paramDefaults: current.paramDefaults || {},
        visibility: current.visibility || null,
        bases: current.bases || [],
        modifiers: current.modifiers || null,
        dataflow: current.dataflow || null,
        controlFlow: current.controlFlow || null,
        throws: current.throws || [],
        awaits: current.awaits || [],
        yields: current.yields || false,
        async: current.async || false,
        docstring: current.docstring || '',
        fields: current.fields || []
      }
    });
  }
  return chunks;
}
