import { buildReverseAdjacencyCsr } from '../indexes.js';
import { compareStrings } from '../../shared/sort.js';

function* mergeSortedUniqueStrings(left, right) {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();
  let a = leftIterator.next();
  let b = rightIterator.next();
  // Preserve the one-sided resolver contract as well as the merged ordering.
  if (a.done) {
    if (!b.done) yield b.value;
    yield* rightIterator;
    return;
  }
  if (b.done) {
    yield a.value;
    yield* leftIterator;
    return;
  }
  let last = null;
  while (!a.done || !b.done) {
    const pickLeft = b.done || (!a.done && compareStrings(a.value, b.value) <= 0);
    const value = pickLeft ? a.value : b.value;
    if (pickLeft) a = leftIterator.next();
    else b = rightIterator.next();
    if (!value || value === last) continue;
    yield value;
    last = value;
  }
}

/** Borrow the immutable CSR row for the duration of synchronous traversal. */
export function* iterateCsrNeighborIds({ ids, offsets, edges, nodeIndex }) {
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
}

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

export const createCsrNeighborIterator = ({ graphIndex }) => {
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
      const out = iterateCsrNeighborIds({ ...graph, nodeIndex });
      return normalizeNeighborList(out, normalizeNeighborId);
    }
    if (dir === 'in') {
      const reverse = ensureReverseCsr(graphName);
      if (!reverse) return [];
      const incoming = iterateCsrNeighborIds({
        ids: graph.ids,
        offsets: reverse.offsets,
        edges: reverse.edges,
        nodeIndex
      });
      return normalizeNeighborList(incoming, normalizeNeighborId);
    }
    const out = resolveCsrNeighbors(graphName, nodeId, 'out', normalizeNeighborId) || [];
    const incoming = resolveCsrNeighbors(graphName, nodeId, 'in', normalizeNeighborId) || [];
    return mergeSortedUniqueStrings(out, incoming);
  };

  return resolveCsrNeighbors;
};

/** Keep the materialized resolver contract for callers that need an array. */
export const createCsrNeighborResolver = (options) => {
  const iterate = createCsrNeighborIterator(options);
  return (...args) => {
    const neighbors = iterate(...args);
    return neighbors === null || options?.iterable === true ? neighbors : Array.from(neighbors);
  };
};
