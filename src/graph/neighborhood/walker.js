import { compareStrings } from '../../shared/sort.js';
import { createCsrNeighborResolver } from './csr.js';

export const createGraphNeighborResolver = ({ graphIndex, iterableCsr = false }) => {
  const resolveCsrNeighbors = createCsrNeighborResolver({ graphIndex, iterable: iterableCsr });

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

/** Borrow sorted adjacency while retaining each recorded edge's orientation. */
export const createDirectedGraphNeighborResolver = options => {
  const resolve = createGraphNeighborResolver(options);
  return function* (graphNodes, nodeId, dir, normalizeNeighborId, adjacencyIndex, graphName) {
    const neighbors = direction => resolve(graphNodes, nodeId, direction, normalizeNeighborId, adjacencyIndex, graphName);
    const edge = (neighborId, incoming) => ({ neighborId,
      fromId: incoming ? neighborId : nodeId, toId: incoming ? nodeId : neighborId });
    if (dir !== 'both') {
      for (const neighborId of neighbors(dir)) yield edge(neighborId, dir === 'in');
      return;
    }
    const outgoing = neighbors('out')[Symbol.iterator](), incoming = neighbors('in')[Symbol.iterator]();
    let out = outgoing.next(), into = incoming.next();
    while (!out.done || !into.done) {
      if (into.done || !out.done && compareStrings(out.value, into.value) <= 0) {
        const neighborId = out.value;
        yield edge(neighborId, false);
        out = outgoing.next();
        // A self-loop appears in both rows but records only one directed edge.
        if (!into.done && neighborId === nodeId && into.value === neighborId) into = incoming.next();
      } else {
        yield edge(into.value, true);
        into = incoming.next();
      }
    }
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
