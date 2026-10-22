import { SymbolKind } from 'vscode-languageserver-protocol';

const isSymbolInformation = (symbol) => Boolean(symbol && symbol.location && symbol.location.range);

const VALID_SYMBOL_KINDS = new Set(
  Object.values(SymbolKind).filter((value) => Number.isInteger(value))
);

const isValidKind = (kind) => Number.isInteger(kind) && VALID_SYMBOL_KINDS.has(kind);
const coerceKind = (kind) => (isValidKind(kind) ? kind : null);

function flattenDocumentSymbols(symbols, parentName = '') {
  const out = [];
  const frames=[{symbols,index:0,parentName}],active=new Set([symbols]);
  while (frames.length) {
    const frame=frames[frames.length-1];
    if (frame.index>=frame.symbols.length) { active.delete(frame.symbols);frames.pop();continue; }
    const symbol=frame.symbols[frame.index++];
    if (!symbol || !symbol.name || !symbol.range) continue;
    const fullName = frame.parentName ? `${frame.parentName}.${symbol.name}` : symbol.name;
    out.push({
      name: symbol.name,
      fullName,
      kind: coerceKind(symbol.kind),
      range: symbol.range,
      selectionRange: symbol.selectionRange || null,
      detail: symbol.detail || null,
      protocolShape: 'DocumentSymbol'
    });
    if (Array.isArray(symbol.children) && symbol.children.length) {
      if (active.has(symbol.children)) throw new TypeError('Cyclic LSP document symbols are not protocol data.');
      active.add(symbol.children);frames.push({symbols:symbol.children,index:0,parentName:fullName});
    }
  }
  return out;
}

function flattenSymbolInformation(symbols) {
  const out = [];
  for (const symbol of symbols || []) {
    if (!symbol || !symbol.name || !symbol.location?.range) continue;
    const container = symbol.containerName || '';
    const fullName = container ? `${container}.${symbol.name}` : symbol.name;
    out.push({
      name: symbol.name,
      fullName,
      kind: coerceKind(symbol.kind),
      range: symbol.location.range,
      selectionRange: symbol.location.range,
      detail: symbol.detail || null,
      containerName: container || null,
      uri: symbol.location.uri || null,
      protocolShape: 'SymbolInformation'
    });
  }
  return out;
}

/**
 * Normalize LSP symbols into a flat list with names and ranges.
 * @param {Array} symbols
 * @returns {Array<{name:string,fullName:string,kind:number|null,range:object,selectionRange:object,detail:string|null,containerName?:string|null}>}
 */
export function flattenSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];
  if (isSymbolInformation(symbols[0])) {
    return flattenSymbolInformation(symbols);
  }
  return flattenDocumentSymbols(symbols);
}
