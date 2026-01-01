const isSymbolInformation = (symbol) => Boolean(symbol && symbol.location && symbol.location.range);

const coerceKind = (kind) => (kind === undefined ? null : kind);

function flattenDocumentSymbols(symbols, parentName = '') {
  const out = [];
  for (const symbol of symbols || []) {
    if (!symbol || !symbol.name || !symbol.range) continue;
    const fullName = parentName ? `${parentName}.${symbol.name}` : symbol.name;
    out.push({
      name: symbol.name,
      fullName,
      kind: coerceKind(symbol.kind),
      range: symbol.range,
      selectionRange: symbol.selectionRange || symbol.range,
      detail: symbol.detail || null
    });
    if (Array.isArray(symbol.children) && symbol.children.length) {
      out.push(...flattenDocumentSymbols(symbol.children, fullName));
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
      containerName: container || null
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
