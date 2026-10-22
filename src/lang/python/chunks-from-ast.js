import { buildLineIndex, offsetToLine } from './normalize.js';

// CPython columns count UTF-8 bytes; published source ranges count UTF-16 units.
// Cache a bounded column table only for requested non-ASCII lines. A zero table
// entry marks the middle of a multibyte code point, never an admissible boundary.
const createByteColumnResolver = (text, lineIndex) => {
  const lines = new Map();
  return (line, column = 0) => {
    if (!Number.isSafeInteger(line) || line < 1 || line > lineIndex.length
      || !Number.isSafeInteger(column) || column < 0) throw new RangeError('Invalid Python AST source coordinate.');
    let info = lines.get(line);
    if (!info) {
      const start = lineIndex[line - 1];
      let end = line < lineIndex.length ? lineIndex[line] - 1 : text.length;
      if (end > start && text[end - 1] === '\r') end -= 1;
      const source = text.slice(start, end), byteLength = Buffer.byteLength(source, 'utf8');
      let columns = null;
      if (byteLength !== source.length) {
        columns = new Uint32Array(byteLength + 1);
        columns[0] = 1;
        let bytes = 0, units = 0;
        for (const character of source) {
          const code = character.codePointAt(0);
          bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
          units += character.length;
          columns[bytes] = units + 1;
        }
      }
      info = { start, byteLength, columns };
      lines.set(line, info);
    }
    if (column > info.byteLength || info.columns && !info.columns[column]) {
      throw new RangeError('Python AST column is outside the line or splits a UTF-8 code point.');
    }
    return info.start + (info.columns ? info.columns[column] - 1 : column);
  };
};

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
  const resolveByteColumn = createByteColumnResolver(text, lineIndex);
  const defs = astData.defs
    .filter((def) => Number.isFinite(def.startLine))
    .map((def) => ({
      ...def,
      start: resolveByteColumn(def.startLine, def.startCol ?? 0)
    }))
    .sort((a, b) => a.start - b.start);
  if (!defs.length) return null;

  const chunks = [];
  for (let i = 0; i < defs.length; i++) {
    const current = defs[i];
    const next = defs[i + 1];
    let end = null;
    if (Number.isFinite(current.endLine)) {
      end = resolveByteColumn(current.endLine, current.endCol ?? 0);
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
        definitionStartLine: current.definitionStartLine ?? current.startLine,
        definitionStartCol: current.definitionStartCol ?? current.startCol,
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
