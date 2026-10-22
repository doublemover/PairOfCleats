import { compareStrings } from '../../shared/sort.js';
import { createCsrNeighborResolver } from './csr.js';

export const createGraphNeighborResolver = ({ graphIndex, iterableCsr = false }) => {
  const resolveCsrNeighbors = createCsrNeighborResolver({ graphIndex, iterable: iterableCsr });

  const resolve = (
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
  resolve.count = (graphNodes, nodeId, dir, normalizeNeighborId, adjacencyIndex, graphName) => {
    const csrCount = resolveCsrNeighbors.count(graphName, nodeId, dir);
    if (csrCount != null) return csrCount;
    const row = adjacencyIndex?.get(nodeId);
    if (!row) return null;
    const out = row.out || [], incoming = row.in || [];
    if (dir === 'out') return out.length;
    if (dir === 'in') return incoming.length;
    const contains = list => {
      if (graphIndex?.adjacencyOrder !== 'sorted-unique') return list.includes(nodeId);
      let low = 0, high = list.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compareStrings(list[middle], nodeId) < 0) low = middle + 1;
        else high = middle;
      }
      return list[low] === nodeId;
    };
    return out.length + incoming.length - (contains(out) && contains(incoming) ? 1 : 0);
  };
  return resolve;
};

/** Borrow sorted adjacency while retaining each recorded edge's orientation. */
export const createDirectedGraphNeighborResolver = options => {
  const resolve = createGraphNeighborResolver(options);
  return function* (graphNodes, nodeId, dir, normalizeNeighborId, adjacencyIndex, graphName, controls = {}) {
    const neighbors = direction => resolve(graphNodes, nodeId, direction, normalizeNeighborId, adjacencyIndex, graphName);
    const total = resolve.count(graphNodes, nodeId, dir, normalizeNeighborId, adjacencyIndex, graphName);
    const limit = controls.limit ?? Infinity;
    let visited = 0;
    if (total != null) controls.onCount?.(total);
    if (total != null && limit <= 0) return;
    const edge = (neighborId, incoming) => ({ neighborId,
      fromId: incoming ? neighborId : nodeId, toId: incoming ? nodeId : neighborId });
    if (dir !== 'both') {
      for (const neighborId of neighbors(dir)) {
        if (visited++ < limit) yield edge(neighborId, dir === 'in');
        if (total != null && visited >= limit) break;
      }
      if (total == null) controls.onCount?.(visited);
      return;
    }
    const outgoing = neighbors('out')[Symbol.iterator](), incoming = neighbors('in')[Symbol.iterator]();
    let out = outgoing.next(), into = incoming.next();
    while (!out.done || !into.done) {
      if (into.done || !out.done && compareStrings(out.value, into.value) <= 0) {
        const neighborId = out.value;
        if (visited++ < limit) yield edge(neighborId, false);
        out = outgoing.next();
        // A self-loop appears in both rows but records only one directed edge.
        if (!into.done && neighborId === nodeId && into.value === neighborId) into = incoming.next();
      } else {
        if (visited++ < limit) yield edge(into.value, true);
        into = incoming.next();
      }
      if (total != null && visited >= limit) break;
    }
    if (total == null) controls.onCount?.(visited);
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
