import { buildReverseAdjacencyCsr } from '../indexes.js';
import { compareStrings } from '../../shared/sort.js';

const mergeSortedUniqueStrings = (left, right) => {
  const out = [];
  let i = 0;
  let j = 0;
  let last = null;
  while (i < left.length || j < right.length) {
    const pickLeft = j >= right.length
      || (i < left.length && compareStrings(left[i], right[j]) <= 0);
    const value = pickLeft ? left[i++] : right[j++];
    if (!value || value === last) continue;
    out.push(value);
    last = value;
  }
  return out;
};

export const collectCsrNeighborIds = ({ ids, offsets, edges, nodeIndex }) => {
  if (!Array.isArray(ids)) return [];
  if (!(offsets instanceof Uint32Array) || !(edges instanceof Uint32Array)) return [];
  if (!Number.isFinite(nodeIndex) || nodeIndex < 0 || nodeIndex + 1 >= offsets.length) return [];
  const start = offsets[nodeIndex];
  const end = offsets[nodeIndex + 1];
  if (end <= start) return [];
  const neighbors = [];
  let prev = null;
  for (let idx = start; idx < end; idx += 1) {
    const neighborIndex = edges[idx];
    if (prev != null && neighborIndex === prev) continue;
    prev = neighborIndex;
    const neighborId = ids[neighborIndex];
    if (neighborId) neighbors.push(neighborId);
  }
  return neighbors;
};

export const normalizeNeighborList = (neighbors, normalizeNeighborId) => {
  if (!normalizeNeighborId) return neighbors;
  const set = new Set();
  for (const entry of neighbors) {
    const normalized = normalizeNeighborId(entry);
    if (normalized) set.add(normalized);
  }
  const list = Array.from(set);
  list.sort(compareStrings);
  return list;
};

export const createCsrNeighborResolver = ({ graphIndex }) => {
  const ensureReverseCsr = (graphName) => {
    if (!graphIndex?.graphRelationsCsr || !graphName) return null;
    const forward = graphIndex.graphRelationsCsr[graphName];
    if (!forward || !(forward.offsets instanceof Uint32Array) || !(forward.edges instanceof Uint32Array)) return null;
    const cache = graphIndex._csrReverseByGraph || (graphIndex._csrReverseByGraph = {});
    if (cache[graphName]) return cache[graphName];
    const reverse = buildReverseAdjacencyCsr({ offsets: forward.offsets, edges: forward.edges });
    if (!reverse) return null;
    cache[graphName] = reverse;
    return reverse;
  };

  const resolveCsrNeighbors = (graphName, nodeId, dir, normalizeNeighborId = null) => {
    const csr = graphIndex?.graphRelationsCsr;
    if (!csr || !graphName) return null;
    const graph = csr[graphName];
    if (!graph || !Array.isArray(graph.ids)) return null;
    const idTable = graphName === 'callGraph'
      ? graphIndex.callGraphIds
      : graphName === 'usageGraph'
        ? graphIndex.usageGraphIds
        : graphIndex.importGraphIds;
    const nodeIndex = idTable?.idToIndex?.get(nodeId);
    if (nodeIndex == null) return [];
    if (dir === 'out') {
      const out = collectCsrNeighborIds({ ...graph, nodeIndex });
      return normalizeNeighborList(out, normalizeNeighborId);
    }
    if (dir === 'in') {
      const reverse = ensureReverseCsr(graphName);
      if (!reverse) return [];
      const incoming = collectCsrNeighborIds({
        ids: graph.ids,
        offsets: reverse.offsets,
        edges: reverse.edges,
        nodeIndex
      });
      return normalizeNeighborList(incoming, normalizeNeighborId);
    }
    const out = resolveCsrNeighbors(graphName, nodeId, 'out', normalizeNeighborId) || [];
    const incoming = resolveCsrNeighbors(graphName, nodeId, 'in', normalizeNeighborId) || [];
    if (!out.length) return incoming;
    if (!incoming.length) return out;
    return mergeSortedUniqueStrings(out, incoming);
  };

  return resolveCsrNeighbors;
};
