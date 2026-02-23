export const GRAPH_EDGE_TYPES = {
  callGraph: 'call',
  usageGraph: 'usage',
  importGraph: 'import'
};

export const GRAPH_NODE_TYPES = {
  callGraph: 'chunk',
  usageGraph: 'chunk',
  importGraph: 'file'
};

export const GRAPH_NAMES = new Set(['callGraph', 'usageGraph', 'importGraph', 'symbolEdges']);

const EDGE_TYPE_ALIASES = new Map([
  ['calls', 'call'],
  ['call', 'call'],
  ['imports', 'import'],
  ['import', 'import'],
  ['usages', 'usage'],
  ['usage', 'usage'],
  ['exports', 'export'],
  ['export', 'export'],
  ['dataflow', 'dataflow'],
  ['symbols', 'symbol'],
  ['symbol', 'symbol']
]);

const KNOWN_EDGE_TYPES = new Set(['call', 'usage', 'import', 'export', 'dataflow', 'symbol']);

const normalizeFilterList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry)).filter(Boolean);
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeEdgeType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return EDGE_TYPE_ALIASES.get(raw) || raw;
};

export const normalizeEdgeFilter = (edgeFilters) => {
  const graphs = normalizeFilterList(edgeFilters?.graphs);
  const edgeTypesRaw = normalizeFilterList(edgeFilters?.edgeTypes);
  const edgeTypes = [];
  const unknownGraphs = [];
  const unknownEdgeTypes = [];
  for (const entry of graphs) {
    if (!GRAPH_NAMES.has(entry)) unknownGraphs.push(entry);
  }
  for (const entry of edgeTypesRaw) {
    const normalized = normalizeEdgeType(entry);
    if (!normalized || !KNOWN_EDGE_TYPES.has(normalized)) {
      unknownEdgeTypes.push(entry);
      continue;
    }
    edgeTypes.push(normalized);
  }
  const minConfidenceRaw = Number(edgeFilters?.minConfidence);
  const minConfidence = Number.isFinite(minConfidenceRaw) ? minConfidenceRaw : null;
  return {
    graphs: graphs.length ? new Set(graphs) : null,
    edgeTypes: edgeTypes.length ? new Set(edgeTypes) : null,
    minConfidence,
    unknownGraphs,
    unknownEdgeTypes,
    normalizedEdgeTypes: edgeTypes
  };
};

export const createEdgeFilterPredicate = ({ graphFilter, edgeTypeFilter, minConfidence }) => (
  ({ graph, edgeType, confidence }) => {
    if (graphFilter && !graphFilter.has(graph)) return false;
    if (edgeTypeFilter && !edgeTypeFilter.has(String(edgeType || '').toLowerCase())) return false;
    if (minConfidence != null && confidence != null && confidence < minConfidence) return false;
    return true;
  }
);
