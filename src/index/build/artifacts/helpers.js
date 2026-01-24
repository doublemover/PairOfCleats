const GRAPH_RELATION_GRAPHS = ['callGraph', 'usageGraph', 'importGraph'];

export const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0B';
  if (value < 1024) return `${Math.round(value)}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)}GB`;
};

export const summarizeFilterIndex = (value) => {
  if (!value || typeof value !== 'object') return null;
  const countMap = (map) => {
    if (!map || typeof map !== 'object') return { keys: 0, entries: 0 };
    let keys = 0;
    let entries = 0;
    for (const list of Object.values(map)) {
      keys += 1;
      if (Array.isArray(list)) entries += list.length;
    }
    return { keys, entries };
  };
  const fileById = Array.isArray(value.fileById) ? value.fileById : [];
  const fileChunksById = Array.isArray(value.fileChunksById) ? value.fileChunksById : [];
  const fileChunkRefs = fileChunksById.reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0
  );
  let jsonBytes = null;
  try {
    jsonBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {}
  return {
    fileChargramN: Number.isFinite(Number(value.fileChargramN)) ? Number(value.fileChargramN) : null,
    fileCount: fileById.length,
    fileChunkRefs,
    byExt: countMap(value.byExt),
    byKind: countMap(value.byKind),
    byAuthor: countMap(value.byAuthor),
    byChunkAuthor: countMap(value.byChunkAuthor),
    byVisibility: countMap(value.byVisibility),
    fileChargrams: countMap(value.fileChargrams),
    jsonBytes
  };
};

export const createGraphRelationsIterator = (relations) => function* graphRelationsIterator() {
  if (!relations || typeof relations !== 'object') return;
  for (const graphName of GRAPH_RELATION_GRAPHS) {
    const graph = relations[graphName];
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      yield { graph: graphName, node };
    }
  }
};

export const measureGraphRelations = (relations, { maxJsonBytes } = {}) => {
  if (!relations || typeof relations !== 'object') return null;
  const graphs = {};
  const graphSizes = {};
  let totalJsonlBytes = 0;
  let totalEntries = 0;
  for (const graphName of GRAPH_RELATION_GRAPHS) {
    const graph = relations[graphName] || {};
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const nodeCount = Number.isFinite(graph.nodeCount) ? graph.nodeCount : nodes.length;
    const edgeCount = Number.isFinite(graph.edgeCount)
      ? graph.edgeCount
      : nodes.reduce((sum, node) => sum + (Array.isArray(node?.out) ? node.out.length : 0), 0);
    graphs[graphName] = { nodeCount, edgeCount };
    let nodesBytes = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const nodeJson = JSON.stringify(node);
      nodesBytes += Buffer.byteLength(nodeJson, 'utf8') + (i > 0 ? 1 : 0);
      const line = JSON.stringify({ graph: graphName, node });
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (maxJsonBytes && (lineBytes + 1) > maxJsonBytes) {
        throw new Error(`graph_relations entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonlBytes += lineBytes + 1;
      totalEntries += 1;
    }
    const baseGraphBytes = Buffer.byteLength(
      JSON.stringify({ nodeCount, edgeCount, nodes: [] }),
      'utf8'
    );
    graphSizes[graphName] = baseGraphBytes + nodesBytes;
  }
  const version = Number.isFinite(relations.version) ? relations.version : 1;
  const generatedAt = typeof relations.generatedAt === 'string'
    ? relations.generatedAt
    : new Date().toISOString();
  const basePayload = {
    version,
    generatedAt,
    callGraph: {},
    usageGraph: {},
    importGraph: {}
  };
  if (relations.caps !== undefined) basePayload.caps = relations.caps;
  const baseBytes = Buffer.byteLength(JSON.stringify(basePayload), 'utf8');
  const totalJsonBytes = baseBytes
    + graphSizes.callGraph - 2
    + graphSizes.usageGraph - 2
    + graphSizes.importGraph - 2;
  return { totalJsonBytes, totalJsonlBytes, totalEntries, graphs, version, generatedAt };
};

export const estimatePostingsBytes = (vocab, postingsList, sampleLimit = 200) => {
  const total = Array.isArray(vocab) ? vocab.length : 0;
  if (!total) return null;
  const sampleSize = Math.min(total, sampleLimit);
  let sampledBytes = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const token = vocab[i];
    const posting = postingsList?.[i] || [];
    sampledBytes += Buffer.byteLength(JSON.stringify(token), 'utf8') + 1;
    sampledBytes += Buffer.byteLength(JSON.stringify(posting), 'utf8') + 1;
  }
  if (!sampledBytes) return null;
  const avgBytes = sampledBytes / sampleSize;
  return { avgBytes, estimatedBytes: avgBytes * total };
};
