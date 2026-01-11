import { buildLineIndex, offsetToLine } from './normalize.js';

/**
 * Heuristic Python chunker when AST is unavailable.
 * Returns null when no declarations are found.
 * @param {string} text
 * @returns {Array<{start:number,end:number,name:string,kind:string,meta:Object}>|null}
 */
export function buildPythonHeuristicChunks(text) {
  const lineIndex = buildLineIndex(text);
  const defs = [];
  const classStack = [];
  const indentValue = (prefix) => prefix.replace(/\t/g, '    ').length;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^([ \t]*)(async\s+)?(class|def)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!match) continue;
    const indent = indentValue(match[1]);
    const isAsync = Boolean(match[2]);
    while (classStack.length && indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }
    const kind = match[3] === 'class' ? 'ClassDeclaration' : 'FunctionDeclaration';
    let name = match[4];
    if (kind === 'ClassDeclaration') {
      classStack.push({ name, indent });
    } else if (classStack.length && indent > classStack[classStack.length - 1].indent) {
      name = `${classStack[classStack.length - 1].name}.${name}`;
    }
    defs.push({
      start: lineIndex[i],
      startLine: i + 1,
      indent,
      name,
      kind,
      async: kind === 'FunctionDeclaration' ? isAsync : false
    });
  }
  if (defs.length) {
    const chunks = [];
    for (let i = 0; i < defs.length; i++) {
      const current = defs[i];
      let end = text.length;
      for (let j = i + 1; j < defs.length; j++) {
        if (defs[j].indent <= current.indent) {
          end = defs[j].start;
          break;
        }
      }
      const endLine = offsetToLine(lineIndex, end);
      chunks.push({
        start: current.start,
        end,
        name: current.name,
        kind: current.kind,
        meta: { startLine: current.startLine, endLine, async: current.async || false }
      });
    }
    return chunks;
  }
  return null;
}
