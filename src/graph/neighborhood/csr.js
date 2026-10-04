import { buildReverseAdjacencyCsr } from '../indexes.js';
import { compareStrings } from '../../shared/sort.js';

const mergeSortedUniqueStrings = function* (left, right) {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();
  let leftEntry = leftIterator.next();
  let rightEntry = rightIterator.next();
  let last = null;
  while (!leftEntry.done || !rightEntry.done) {
    const pickLeft = rightEntry.done
      || (!leftEntry.done && compareStrings(leftEntry.value, rightEntry.value) <= 0);
    const value = pickLeft ? leftEntry.value : rightEntry.value;
    if (pickLeft) leftEntry = leftIterator.next();
    else rightEntry = rightIterator.next();
    if (!value || value === last) continue;
    yield value;
    last = value;
  }
};

/** Borrow a single immutable CSR row without retaining a neighbor-count-sized array. */
export const iterateCsrNeighborIds = function* ({ ids, offsets, edges, nodeIndex }) {
  if (!Array.isArray(ids)) return;
  if (!(offsets instanceof Uint32Array) || !(edges instanceof Uint32Array)) return;
  if (!Number.isFinite(nodeIndex) || nodeIndex < 0 || nodeIndex + 1 >= offsets.length) return;
  const start = offsets[nodeIndex];
  const end = offsets[nodeIndex + 1];
  if (end <= start) return;
  let prev = null;
  for (let idx = start; idx < end; idx += 1) {
    const neighborIndex = edges[idx];
    if (prev != null && neighborIndex === prev) continue;
    prev = neighborIndex;
    const neighborId = ids[neighborIndex];
    if (neighborId) yield neighborId;
  }
};

export const collectCsrNeighborIds = (input) => Array.from(iterateCsrNeighborIds(input));

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

export const createCsrNeighborResolver = ({ graphIndex, iterable = false }) => {
  const resolveNeighborRows = (input, normalizeNeighborId) => {
    const rows = iterateCsrNeighborIds(input);
    // Import normalization can reorder/collapse IDs and must retain its existing
    // eager normalization and sorting. Raw call/usage IDs can borrow the CSR span.
    if (normalizeNeighborId) return normalizeNeighborList(Array.from(rows), normalizeNeighborId);
    return iterable ? rows : Array.from(rows);
  };
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
      return resolveNeighborRows({ ...graph, nodeIndex }, normalizeNeighborId);
    }
    if (dir === 'in') {
      const reverse = ensureReverseCsr(graphName);
      if (!reverse) return [];
      return resolveNeighborRows({
        ids: graph.ids,
        offsets: reverse.offsets,
        edges: reverse.edges,
        nodeIndex
      }, normalizeNeighborId);
    }
    const out = resolveCsrNeighbors(graphName, nodeId, 'out', normalizeNeighborId) || [];
    const incoming = resolveCsrNeighbors(graphName, nodeId, 'in', normalizeNeighborId) || [];
    if (!iterable || normalizeNeighborId) {
      if (!out.length) return incoming;
      if (!incoming.length) return out;
      return Array.from(mergeSortedUniqueStrings(out, incoming));
    }
    return mergeSortedUniqueStrings(out, incoming);
  };

  return resolveCsrNeighbors;
};
