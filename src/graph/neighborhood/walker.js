import { compareStrings } from '../../shared/sort.js';
import { createCsrNeighborResolver } from './csr.js';

export const createGraphNeighborResolver = ({ graphIndex }) => {
  const resolveCsrNeighbors = createCsrNeighborResolver({ graphIndex });

  return (
    graphNodes,
    nodeId,
    dir,
    normalizeNeighborId = null,
    adjacencyIndex = null,
    graphName = null
  ) => {
    const csrNeighbors = resolveCsrNeighbors(graphName, nodeId, dir, normalizeNeighborId);
    if (csrNeighbors) return csrNeighbors;
    if (adjacencyIndex && adjacencyIndex.has(nodeId)) {
      const entry = adjacencyIndex.get(nodeId);
      if (!entry) return [];
      if (dir === 'out') return entry.out || [];
      if (dir === 'in') return entry.in || [];
      if (entry.both) return entry.both;
      const out = Array.isArray(entry.out) ? entry.out : [];
      const incoming = Array.isArray(entry.in) ? entry.in : [];
      if (!out.length && !incoming.length) return [];
      const set = new Set();
      for (const neighbor of out) set.add(neighbor);
      for (const neighbor of incoming) set.add(neighbor);
      const list = Array.from(set);
      list.sort(compareStrings);
      return list;
    }
    const node = graphNodes.get(nodeId);
    if (!node) return [];
    const out = Array.isArray(node.out) ? node.out : [];
    const incoming = Array.isArray(node.in) ? node.in : [];
    let neighbors = [];
    if (dir === 'out') neighbors = out;
    else if (dir === 'in') neighbors = incoming;
    else neighbors = out.concat(incoming);
    const set = new Set();
    for (const neighbor of neighbors) {
      if (!neighbor) continue;
      const normalized = normalizeNeighborId ? normalizeNeighborId(neighbor) : neighbor;
      if (!normalized) continue;
      set.add(normalized);
    }
    const list = Array.from(set);
    list.sort(compareStrings);
    return list;
  };
};

export const resolveSymbolNeighbors = (hasSymbolEdges, symbolIndex, ref, dir) => {
  if (!hasSymbolEdges) return [];
  if (ref.type === 'chunk') {
    if (dir === 'in') return [];
    return symbolIndex.byChunk.get(ref.chunkUid) || [];
  }
  if (ref.type === 'symbol') {
    if (dir === 'out') return [];
    return symbolIndex.bySymbol.get(ref.symbolId) || [];
  }
  return [];
};
