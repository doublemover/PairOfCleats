import { compareStrings } from '../sort.js';

const GRAPH_RELATION_GRAPHS = Object.freeze(['callGraph', 'usageGraph', 'importGraph']);
const GRAPH_RELATIONS_CSR_GRAPHS = GRAPH_RELATION_GRAPHS;

const normalizeInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
};

const ensureSortedUniqueStrings = (items, { label, strict } = {}) => {
  const list = Array.isArray(items) ? items : null;
  if (!list) {
    const err = new Error(`Invalid ${label}: expected array`);
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return [];
  }
  const out = [];
  let prev = null;
  for (const entry of list) {
    if (typeof entry !== 'string' || !entry) {
      const err = new Error(`Invalid ${label}: node id must be a non-empty string`);
      err.code = 'ERR_GRAPH_CSR_INVALID';
      if (strict) throw err;
      continue;
    }
    out.push(entry);
  }
  for (let i = 0; i < out.length; i += 1) {
    const current = out[i];
    if (prev != null) {
      const cmp = compareStrings(prev, current);
      if (cmp >= 0) {
        const err = new Error(`Invalid ${label}: nodes must be sorted and unique`);
        err.code = 'ERR_GRAPH_CSR_INVALID';
        if (strict) throw err;
        out.sort(compareStrings);
        // Best-effort unique after repair.
        const unique = [];
        let last = null;
        for (const value of out) {
          if (last === value) continue;
          unique.push(value);
          last = value;
        }
        return unique;
      }
    }
    prev = current;
  }
  return out;
};

const normalizeUint32List = (value, { label, strict } = {}) => {
  const list = Array.isArray(value) ? value : null;
  if (!list) {
    const err = new Error(`Invalid ${label}: expected array`);
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return new Uint32Array();
  }
  const out = new Uint32Array(list.length);
  for (let i = 0; i < list.length; i += 1) {
    const parsed = normalizeInt(list[i], NaN);
    if (!Number.isFinite(parsed) || parsed < 0) {
      const err = new Error(`Invalid ${label}: expected non-negative integers`);
      err.code = 'ERR_GRAPH_CSR_INVALID';
      if (strict) throw err;
      out[i] = 0;
      continue;
    }
    out[i] = parsed;
  }
  return out;
};

const validateOffsets = (offsets, { nodeCount, edgeCount, label, strict } = {}) => {
  if (!(offsets instanceof Uint32Array) || offsets.length !== nodeCount + 1) {
    const err = new Error(`Invalid ${label}: offsets length mismatch`);
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return false;
  }
  if (offsets.length && offsets[0] !== 0) {
    const err = new Error(`Invalid ${label}: offsets[0] must be 0`);
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return false;
  }
  for (let i = 1; i < offsets.length; i += 1) {
    if (offsets[i] < offsets[i - 1]) {
      const err = new Error(`Invalid ${label}: offsets must be monotonic`);
      err.code = 'ERR_GRAPH_CSR_INVALID';
      if (strict) throw err;
      return false;
    }
  }
  if (offsets.length && offsets[offsets.length - 1] !== edgeCount) {
    const err = new Error(`Invalid ${label}: offsets end must equal edges length`);
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return false;
  }
  return true;
};

const validateEdges = (edges, { nodeCount, label, strict } = {}) => {
  if (!(edges instanceof Uint32Array)) {
    const err = new Error(`Invalid ${label}: edges must be uint32`);
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return false;
  }
  for (let i = 0; i < edges.length; i += 1) {
    const value = edges[i];
    if (value >= nodeCount) {
      const err = new Error(`Invalid ${label}: edge index out of bounds`);
      err.code = 'ERR_GRAPH_CSR_INVALID';
      if (strict) throw err;
      return false;
    }
  }
  return true;
};

const validateEdgeOrdering = (edges, offsets, { label, strict } = {}) => {
  // Determinism invariant: each node's outgoing list is sorted by target index.
  for (let i = 0; i + 1 < offsets.length; i += 1) {
    const start = offsets[i];
    const end = offsets[i + 1];
    let prev = null;
    for (let j = start; j < end; j += 1) {
      const value = edges[j];
      if (prev != null && value < prev) {
        const err = new Error(`Invalid ${label}: edges must be sorted per node`);
        err.code = 'ERR_GRAPH_CSR_INVALID';
        if (strict) throw err;
        return false;
      }
      prev = value;
    }
  }
  return true;
};

const createGraphPayload = (meta) => ({
  nodeCount: Number.isFinite(meta?.nodeCount) ? meta.nodeCount : null,
  edgeCount: Number.isFinite(meta?.edgeCount) ? meta.edgeCount : null,
  nodes: []
});

const finalizeGraphPayload = (payload) => {
  if (!Number.isFinite(payload.nodeCount)) {
    payload.nodeCount = payload.nodes.length;
  }
  if (!Number.isFinite(payload.edgeCount)) {
    let edgeCount = 0;
    for (const node of payload.nodes) {
      if (Array.isArray(node?.out)) edgeCount += node.out.length;
    }
    payload.edgeCount = edgeCount;
  }
  return payload;
};

export const createGraphRelationsShell = (meta) => {
  const extensions = meta && typeof meta.extensions === 'object' ? meta.extensions : {};
  const graphsMeta = extensions?.graphs || meta?.graphs || {};
  const generatedAt = typeof meta?.generatedAt === 'string'
    ? meta.generatedAt
    : new Date().toISOString();
  const version = Number.isFinite(extensions?.version)
    ? extensions.version
    : (Number.isFinite(meta?.version) ? meta.version : 1);
  const payload = {
    version,
    generatedAt,
    callGraph: createGraphPayload(graphsMeta.callGraph),
    usageGraph: createGraphPayload(graphsMeta.usageGraph),
    importGraph: createGraphPayload(graphsMeta.importGraph)
  };
  const caps = extensions?.caps ?? meta?.caps ?? null;
  if (caps != null) payload.caps = caps;
  return payload;
};

export const appendGraphRelationsEntry = (payload, entry, sourceLabel) => {
  if (!entry) return;
  const graphName = entry.graph;
  if (!GRAPH_RELATION_GRAPHS.includes(graphName)) {
    const err = new Error(
      `Invalid graph_relations entry in ${sourceLabel}: unknown graph "${graphName}"`
    );
    err.code = 'ERR_JSONL_INVALID';
    throw err;
  }
  const node = entry.node;
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    const err = new Error(`Invalid graph_relations entry in ${sourceLabel}: node must be an object`);
    err.code = 'ERR_JSONL_INVALID';
    throw err;
  }
  payload[graphName].nodes.push(node);
};

export const appendGraphRelationsEntries = (payload, entries, sourceLabel) => {
  if (!entries) return;
  for (const entry of entries) {
    appendGraphRelationsEntry(payload, entry, sourceLabel);
  }
};

export const finalizeGraphRelations = (payload) => {
  finalizeGraphPayload(payload.callGraph);
  finalizeGraphPayload(payload.usageGraph);
  finalizeGraphPayload(payload.importGraph);
  return payload;
};

export const normalizeGraphRelationsCsr = (payload, { strict = true } = {}) => {
  if (!payload || typeof payload !== 'object') {
    const err = new Error('Invalid graph_relations_csr payload');
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return null;
  }
  const graphs = payload.graphs && typeof payload.graphs === 'object' ? payload.graphs : null;
  if (!graphs) {
    const err = new Error('Invalid graph_relations_csr payload: missing graphs');
    err.code = 'ERR_GRAPH_CSR_INVALID';
    if (strict) throw err;
    return null;
  }
  const normalizedGraphs = {};
  for (const graphName of GRAPH_RELATIONS_CSR_GRAPHS) {
    const graph = graphs[graphName];
    if (!graph || typeof graph !== 'object') {
      const err = new Error(`Invalid graph_relations_csr payload: missing ${graphName}`);
      err.code = 'ERR_GRAPH_CSR_INVALID';
      if (strict) throw err;
      normalizedGraphs[graphName] = {
        nodeCount: 0,
        edgeCount: 0,
        nodes: [],
        offsets: new Uint32Array([0]),
        edges: new Uint32Array()
      };
      continue;
    }
    const nodes = ensureSortedUniqueStrings(graph.nodes, { label: `${graphName}.nodes`, strict });
    const offsets = normalizeUint32List(graph.offsets, { label: `${graphName}.offsets`, strict });
    const edges = normalizeUint32List(graph.edges, { label: `${graphName}.edges`, strict });
    const nodeCount = nodes.length;
    const edgeCount = edges.length;

    const declaredNodeCount = normalizeInt(graph.nodeCount, nodeCount);
    const declaredEdgeCount = normalizeInt(graph.edgeCount, edgeCount);
    if (strict) {
      if (declaredNodeCount !== nodeCount) {
        const err = new Error(`Invalid ${graphName}: nodeCount mismatch`);
        err.code = 'ERR_GRAPH_CSR_INVALID';
        throw err;
      }
      if (declaredEdgeCount !== edgeCount) {
        const err = new Error(`Invalid ${graphName}: edgeCount mismatch`);
        err.code = 'ERR_GRAPH_CSR_INVALID';
        throw err;
      }
    }

    validateOffsets(offsets, { nodeCount, edgeCount, label: graphName, strict });
    validateEdges(edges, { nodeCount, label: graphName, strict });
    validateEdgeOrdering(edges, offsets, { label: graphName, strict });

    normalizedGraphs[graphName] = {
      nodeCount,
      edgeCount,
      nodes,
      offsets,
      edges
    };
  }

  return {
    version: normalizeInt(payload.version, 1) ?? 1,
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString(),
    graphs: normalizedGraphs
  };
};
