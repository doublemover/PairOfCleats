import { exactLspRange, lspRangeContains, normalizeLspLocations } from '../../../../index/semantic/lsp-locations.js';

/** Operation-specific observations preserve protocol meaning and exact mapping.
 * An external URI or invalid coordinate remains an explicit non-exact result. */
export const projectLspObservation = ({ requestClass, payload, uri, sourceForUri,
  positionEncoding = 'utf-16', maxFacts = 256, maxDepth = 16, requestItem = null, retainHierarchyItem = () => null }) => {
  const facts = [], omissions = [];
  let factUnits = 0;
  const sourceAt = targetUri => {
    try { return sourceForUri(targetUri) || null; } catch { return null; }
  };
  const mapped = (targetUri, range) => {
    const item = sourceAt(targetUri);
    if (!item) return { uri: targetUri, sourceUnitId: null, sourceHash: null, span: null, state: 'external' };
    const source = item.source || item.manifest;
    const span = exactLspRange(source, item.text, range, positionEncoding);
    return { uri: targetUri, sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
      span, state: span ? source.mapping && source.mapping.quality !== 'exact' ? 'unmapped' : 'exact' : 'invalid_range' };
  };
  const add = fact => {
    if (factUnits >= maxFacts) { if (!omissions.includes('fact_budget')) omissions.push('fact_budget'); return false; }
    facts.push(fact); factUnits += 1; return true;
  };
  const qualifySelection = (target, container, containerRange, selectionRange) => {
    const contained = lspRangeContains(containerRange, selectionRange);
    const exactContainer = target.state !== 'exact' || container?.state === 'exact';
    if (!contained || !exactContainer) {
      omissions.push(contained ? 'invalid_selection_container' : 'selection_outside_container');
      target.state = 'invalid_range'; target.span = null;
    }
  };
  if (['definition', 'typeDefinition', 'references'].includes(requestClass)) {
    for (const location of normalizeLspLocations(payload)) {
      if (factUnits >= maxFacts) { omissions.push('fact_budget'); break; }
      if (!location.valid) { omissions.push('malformed_location'); continue; }
      const target = mapped(location.uri, location.range);
      const container = location.targetRange ? mapped(location.uri, location.targetRange) : null;
      const origin = location.originRange ? mapped(uri, location.originRange) : null;
      qualifySelection(target, container, location.targetRange, location.range);
      if (origin?.state === 'invalid_range') omissions.push('invalid_origin_range');
      add({ kind: requestClass, target, container, origin,
        protocolShape: location.protocolShape });
    }
  } else if (requestClass === 'documentSymbol') {
    if (payload !== null && !Array.isArray(payload)) omissions.push('malformed_symbols');
    const stack = (Array.isArray(payload) ? payload : []).slice(0, maxFacts + 1).reverse().map(value => ({ value, parent: null, depth: 0 }));
    while (stack.length && facts.length < maxFacts) {
      const { value, parent, depth } = stack.pop();
      if (!value || typeof value.name !== 'string' || !Number.isSafeInteger(value.kind)) { omissions.push('malformed_symbol'); continue; }
      const flat = Boolean(value.location), targetUri = flat ? value.location.uri : uri;
      const selection = flat ? value.location.range : value.selectionRange;
      const target = mapped(targetUri, selection), container = flat ? null : mapped(uri, value.range);
      if (!flat) qualifySelection(target, container, value.range, selection);
      const index = facts.length;
      add({ kind: 'symbol', name: value.name, symbolKind: value.kind, detail: value.detail ?? null,
        protocolShape: flat ? 'SymbolInformation' : 'DocumentSymbol', parent,
        containerName: flat ? value.containerName ?? null : null, target, container });
      if (value.children !== undefined && !Array.isArray(value.children)) omissions.push('malformed_symbol_children');
      if (value.children?.length) {
        if (depth >= maxDepth) { omissions.push('symbol_depth_budget'); continue; }
        const remaining = Math.max(0, maxFacts - facts.length - stack.length);
        if (value.children.length > remaining) omissions.push('fact_budget');
        for (const child of value.children.slice(0, remaining).reverse()) stack.push({ value: child, parent: index, depth: depth + 1 });
      }
    }
    if (stack.length) omissions.push('fact_budget');
  } else {
    if (payload !== null && !Array.isArray(payload)) omissions.push('malformed_hierarchy');
    const callEdges = ['incomingCalls', 'outgoingCalls'].includes(requestClass);
    const outgoingContainer = requestClass === 'outgoingCalls' && requestItem
      ? mapped(requestItem.uri, requestItem.range) : null;
    for (const value of Array.isArray(payload) ? payload : []) {
      if (factUnits >= maxFacts) { omissions.push('fact_budget'); break; }
      const item = requestClass === 'incomingCalls' ? value?.from : requestClass === 'outgoingCalls' ? value?.to : value;
      if (!item || typeof item.uri !== 'string' || typeof item.name !== 'string' || !item.selectionRange || !item.range) {
        omissions.push('malformed_hierarchy_item'); continue;
      }
      const target = mapped(item.uri, item.selectionRange), container = mapped(item.uri, item.range);
      qualifySelection(target, container, item.range, item.selectionRange);
      const ranges = [];
      add({ kind: requestClass, name: item.name, symbolKind: item.kind, target, container, fromRanges: ranges,
        itemToken: target.state === 'invalid_range' ? null : retainHierarchyItem(item), completeness: 'provider_observation' });
      if (callEdges) {
        if (!Array.isArray(value.fromRanges)) { omissions.push('malformed_hierarchy_ranges'); continue; }
        const incoming = requestClass === 'incomingCalls';
        const caller = incoming ? item : requestItem, callerContainer = incoming ? container : outgoingContainer;
        for (const range of value.fromRanges) {
          if (factUnits >= maxFacts) { omissions.push('fact_budget', 'hierarchy_range_budget'); break; }
          factUnits += 1;
          const observed = mapped(caller?.uri || uri, range);
          qualifySelection(observed, callerContainer, caller?.range, range);
          if (observed.state !== 'exact') omissions.push('hierarchy_range_unqualified');
          ranges.push(observed);
        }
      }
    }
  }
  return { facts, factUnits, omissions: [...new Set(omissions)], exactCount: facts.filter(fact => fact.target?.state === 'exact').length };
};
