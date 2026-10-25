import { reconcileSelectedScore } from '../scoring/score-adjustment.js';
import { resolveGraphNodeIndexes } from '../../graph/prepared-node-indexes.js';
import { createWorkBudget } from '../../graph/work-budget.js';
import { resolveGraphRankingPolicy } from './graph-ranking-policy.js';
import { compareStrings } from '../../shared/sort.js';

const resolveChunkUid = (chunk) => (
  chunk?.chunkUid || chunk?.metaV2?.chunkUid || null
);

const resolveNeighbors = (index, nodeId) => {
  const node = index.get(nodeId);
  if (!node) return [];
  const out = Array.isArray(node.out) ? node.out : [];
  const incoming = Array.isArray(node.in) ? node.in : [];
  const set = new Set([...out, ...incoming].filter(Boolean));
  const list = Array.from(set);
  list.sort(compareStrings);
  return list;
};

/**
 * Create a memoized resolver that merges call+usage neighbors into one
 * deterministic sorted adjacency list per node.
 *
 * @param {Map<string, object>} callIndex
 * @param {Map<string, object>} usageIndex
 * @returns {(nodeId:string)=>string[]}
 */
const createNeighborResolver = (callIndex, usageIndex) => {
  const cache = new Map();
  return (nodeId) => {
    if (!nodeId) return [];
    const cached = cache.get(nodeId);
    if (cached) return cached;
    const merged = Array.from(new Set([
      ...resolveNeighbors(callIndex, nodeId),
      ...resolveNeighbors(usageIndex, nodeId)
    ]));
    merged.sort(compareStrings);
    cache.set(nodeId, merged);
    return merged;
  };
};

const resolveDegree = (index, nodeId) => {
  const node = index.get(nodeId);
  if (!node) return 0;
  const out = Array.isArray(node.out) ? node.out.length : 0;
  const incoming = Array.isArray(node.in) ? node.in.length : 0;
  return out + incoming;
};

const resolveSeeds = (entries, seedSelection, seedK) => {
  if (seedSelection === 'none') return [];
  if (!entries.length) return [];
  if (seedSelection === 'topK') {
    const limit = Number.isFinite(seedK) ? Math.max(1, Math.floor(seedK)) : 3;
    return entries.slice(0, limit).map((entry) => resolveChunkUid(entry.chunk)).filter(Boolean);
  }
  return [resolveChunkUid(entries[0].chunk)].filter(Boolean);
};

const resolveStopReason = ({ stop, widthLimitedNodes, depthLimitedNodes }) => {
  if (stop?.reason) return stop.reason;
  if (widthLimitedNodes > 0) return 'maxWidthPerNode';
  if (depthLimitedNodes > 0) return 'maxDepth';
  return null;
};

/**
 * Traverse graph neighborhoods with deterministic breadth-first expansion and
 * explicit depth/width/node caps.
 * @param {object} input
 * @returns {{depthByNode:Map<string, number>,widthLimitedNodes:number,depthLimitedNodes:number,stop:object}}
 */
const expandSeedNeighborhood = ({
  seedList,
  resolveMergedNeighbors,
  expansionPolicy,
  budget
}) => {
  const depthByNode = new Map();
  const queue = [];
  for (const seed of seedList) {
    if (!seed || depthByNode.has(seed)) continue;
    depthByNode.set(seed, 0);
    queue.push(seed);
  }
  let cursor = 0;
  let widthLimitedNodes = 0;
  let depthLimitedNodes = 0;
  const stop = {
    reason: null,
    limit: null,
    atNode: null,
    atDepth: null
  };
  while (cursor < queue.length) {
    const nodeId = queue[cursor];
    cursor += 1;
    const depth = depthByNode.get(nodeId) ?? 0;
    if (depth >= expansionPolicy.maxDepth) {
      depthLimitedNodes += 1;
      continue;
    }
    const neighbors = resolveMergedNeighbors(nodeId);
    const boundedNeighbors = neighbors.length > expansionPolicy.maxWidthPerNode
      ? neighbors.slice(0, expansionPolicy.maxWidthPerNode)
      : neighbors;
    if (boundedNeighbors.length < neighbors.length) {
      widthLimitedNodes += 1;
    }
    for (const neighbor of boundedNeighbors) {
      const budgetState = budget.consume(1);
      if (budgetState.stop) {
        stop.reason = budgetState.reason;
        stop.limit = budgetState.limit;
        stop.atNode = nodeId;
        stop.atDepth = depth + 1;
        return { depthByNode, widthLimitedNodes, depthLimitedNodes, stop };
      }
      const nextDepth = depth + 1;
      const knownDepth = depthByNode.get(neighbor);
      if (knownDepth != null && knownDepth <= nextDepth) continue;
      const isNewNode = knownDepth == null;
      if (isNewNode && depthByNode.size >= expansionPolicy.maxVisitedNodes) {
        stop.reason = 'maxVisitedNodes';
        stop.limit = expansionPolicy.maxVisitedNodes;
        stop.atNode = neighbor;
        stop.atDepth = nextDepth;
        return { depthByNode, widthLimitedNodes, depthLimitedNodes, stop };
      }
      depthByNode.set(neighbor, nextDepth);
      if (isNewNode) queue.push(neighbor);
    }
  }
  return { depthByNode, widthLimitedNodes, depthLimitedNodes, stop };
};

/**
 * Apply graph-based score adjustments to ranked entries.
 * @param {object} input
 * @param {Array<object>} input.entries
 * @param {object|null} input.graphRelations
 * @param {object} input.config
 * @param {boolean} [input.explain]
 * @returns {{entries:Array<object>,stats:object|null}}
 */
export const applyGraphRanking = ({
  entries,
  graphRelations,
  config,
  explain = false
} = {}) => {
  if (!Array.isArray(entries) || !entries.length) {
    return { entries: Array.isArray(entries) ? entries : [], stats: null };
  }
  const enabled = config?.enabled === true;
  if (!enabled || !graphRelations) {
    return { entries, stats: null };
  }

  const { degreeWeight, proximityWeight, seedSelection, seedK, maxGraphWorkUnits,
    maxWallClockMs, expansionPolicy } = resolveGraphRankingPolicy(config);
  if (!degreeWeight && !proximityWeight) return { entries, stats: null };

  const { callGraph: callIndex, usageGraph: usageIndex } = resolveGraphNodeIndexes(graphRelations, ['callGraph', 'usageGraph']);
  const resolveMergedNeighbors = createNeighborResolver(callIndex, usageIndex);

  const seedList = resolveSeeds(entries, seedSelection, seedK);
  const seedSet = new Set(seedList);
  const budget = createWorkBudget({ maxWorkUnits: maxGraphWorkUnits, maxWallClockMs });
  const expanded = expandSeedNeighborhood({
    seedList,
    resolveMergedNeighbors,
    expansionPolicy,
    budget
  });
  const stopReason = resolveStopReason(expanded);

  const ranked = entries.map((entry) => {
    const chunkUid = resolveChunkUid(entry.chunk);
    const degree = chunkUid
      ? resolveDegree(callIndex, chunkUid) + resolveDegree(usageIndex, chunkUid)
      : 0;
    const seedDistance = chunkUid ? expanded.depthByNode.get(chunkUid) : null;
    const proximity = seedDistance === 0
      ? 1
      : (Number.isFinite(seedDistance) ? (1 / (seedDistance + 1)) : 0);
    const graphScore = (degreeWeight * degree) + (proximityWeight * proximity);
    const next = { ...entry };
    next.score = entry.score + graphScore;
    if (explain) {
      next.scoreBreakdown = {
        ...(entry.scoreBreakdown || {}),
        graph: {
          score: graphScore,
          degree,
          proximity,
          seedDistance: Number.isFinite(seedDistance) ? seedDistance : null,
          weights: {
            degree: degreeWeight,
            proximity: proximityWeight
          },
          seedSelection,
          seedK: seedK ?? null,
          expansion: {
            maxDepth: expansionPolicy.maxDepth,
            maxWidthPerNode: expansionPolicy.maxWidthPerNode,
            maxVisitedNodes: expansionPolicy.maxVisitedNodes
          },
          stopReason
        }
      };
    }
    if (next.scoreBreakdown) next.scoreBreakdown = reconcileSelectedScore(next.scoreBreakdown, {
      score: next.score, type: next.scoreType, stage: 'graph', sourceScore: entry.score, sourceType: entry.scoreType
    });
    return next;
  });

  ranked.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  return {
    entries: ranked,
    stats: {
      workUnitsUsed: budget.getUsed(),
      truncated: Boolean(stopReason),
      stopReason,
      widthLimitedNodes: expanded.widthLimitedNodes,
      depthLimitedNodes: expanded.depthLimitedNodes,
      visitedNodes: expanded.depthByNode.size,
      expansion: {
        maxDepth: expansionPolicy.maxDepth,
        maxWidthPerNode: expansionPolicy.maxWidthPerNode,
        maxVisitedNodes: expansionPolicy.maxVisitedNodes
      }
    }
  };
};
