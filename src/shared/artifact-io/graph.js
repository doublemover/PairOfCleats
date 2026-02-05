const GRAPH_RELATION_GRAPHS = Object.freeze(['callGraph', 'usageGraph', 'importGraph']);

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
  if (meta?.caps != null) payload.caps = meta.caps;
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
