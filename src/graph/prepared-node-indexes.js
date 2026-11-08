import { performance } from 'node:perf_hooks';
import { buildGraphNodeIndex } from './indexes.js';
import { compareStrings } from '../shared/sort.js';

const prepared = new WeakMap(), emptyNeighbors = Object.freeze([]);
const rankingFamilies = Object.freeze(['callGraph', 'usageGraph']);
const ownerFor = graphRelations => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  let owner = prepared.get(graphRelations);
  if (!owner) {
    owner = { indexes: Object.create(null), rankingNeighbors: new Map() };
    prepared.set(graphRelations, owner);
  }
  return owner;
};

/** Admitted graph relations are immutable for a generation. Replacement uses a
 * new object; this weak owner never holds earlier generations by repository path. */
export const resolveGraphNodeIndexes = (graphRelations, families = ['callGraph', 'usageGraph', 'importGraph'], metrics = null) => {
  const owner = ownerFor(graphRelations);
  if (!owner) return null;
  for (const family of families) {
    if (!owner.indexes[family]) {
      const started = performance.now();
      owner.indexes[family] = buildGraphNodeIndex(graphRelations[family], { metrics });
      if (metrics) {
        metrics.nodeIndexesBuilt = (metrics.nodeIndexesBuilt || 0) + 1;
        metrics.elapsedMs = (metrics.elapsedMs || 0) + Math.max(0, performance.now() - started);
      }
    }
  }
  return owner.indexes;
};

/** One canonical adjacency per demanded node, independent of query width/filter.
 * Prefix selection never mutates this shared immutable generation preparation. */
export const resolveGraphRankingNeighbors = (graphRelations, nodeId, metrics = {}) => {
  const owner = ownerFor(graphRelations);
  if (!owner || !nodeId) return emptyNeighbors;
  if (owner.rankingNeighbors.has(nodeId)) { metrics.adjacencyCacheHits = (metrics.adjacencyCacheHits || 0) + 1; return owner.rankingNeighbors.get(nodeId); }
  const started = performance.now(), values = new Set();
  const indexes = resolveGraphNodeIndexes(graphRelations, rankingFamilies, metrics);
  let found = false;
  for (const family of rankingFamilies) {
    const node = indexes[family].get(nodeId);
    if (!node) continue;
    found = true;
    for (const field of ['out', 'in']) {
      const source = node[field];
      if (!Array.isArray(source)) continue;
      for (const neighbor of source) { metrics.adjacencyInputsVisited = (metrics.adjacencyInputsVisited || 0) + 1; if (neighbor) values.add(neighbor); }
    }
  }
  if (!found) return emptyNeighbors;
  const neighbors = Object.freeze([...values].sort(compareStrings));
  owner.rankingNeighbors.set(nodeId, neighbors);
  metrics.adjacencyListsBuilt = (metrics.adjacencyListsBuilt || 0) + 1; metrics.elapsedMs = (metrics.elapsedMs || 0) + Math.max(0, performance.now() - started);
  return neighbors;
};
