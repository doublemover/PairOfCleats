import { createWorkBudget } from '../../graph/work-budget.js';
import { normalizeOptionalNumber } from '../../shared/limits.js';
import { compareStrings } from '../../shared/sort.js';

const DEFAULT_MAX_WORK_UNITS = 500;

const normalizeSeedSelection = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'topk') return 'topK';
  if (raw === 'top1' || raw === 'topk' || raw === 'none') return raw;
  return 'top1';
};

const buildGraphIndex = (graph) => {
  const map = new Map();
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) continue;
    map.set(node.id, node);
  }
  return map;
};

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

  const weights = config?.weights || {};
  const degreeWeight = Number(weights.degree) || 0;
  const proximityWeight = Number(weights.proximity) || 0;
  if (!degreeWeight && !proximityWeight) {
    return { entries, stats: null };
  }

  const seedSelection = normalizeSeedSelection(config?.seedSelection);
  const seedK = normalizeOptionalNumber(config?.seedK);
  const maxGraphWorkUnits = normalizeOptionalNumber(config?.maxGraphWorkUnits) ?? DEFAULT_MAX_WORK_UNITS;
  const maxWallClockMs = normalizeOptionalNumber(config?.maxWallClockMs);

  const callIndex = buildGraphIndex(graphRelations?.callGraph);
  const usageIndex = buildGraphIndex(graphRelations?.usageGraph);

  const seedList = resolveSeeds(entries, seedSelection, seedK);
  const seedSet = new Set(seedList);
  const neighborSet = new Set();
  const budget = createWorkBudget({ maxWorkUnits: maxGraphWorkUnits, maxWallClockMs });

  for (const seed of seedList) {
    if (!seed) continue;
    const neighbors = [
      ...resolveNeighbors(callIndex, seed),
      ...resolveNeighbors(usageIndex, seed)
    ];
    neighbors.sort(compareStrings);
    for (const neighbor of neighbors) {
      const state = budget.consume(1);
      if (state.stop) break;
      neighborSet.add(neighbor);
    }
    if (budget.getUsed() >= maxGraphWorkUnits) break;
  }

  const ranked = entries.map((entry) => {
    const chunkUid = resolveChunkUid(entry.chunk);
    const degree = chunkUid
      ? resolveDegree(callIndex, chunkUid) + resolveDegree(usageIndex, chunkUid)
      : 0;
    const proximity = chunkUid && seedSet.has(chunkUid)
      ? 1
      : (chunkUid && neighborSet.has(chunkUid) ? 0.5 : 0);
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
          weights: {
            degree: degreeWeight,
            proximity: proximityWeight
          },
          seedSelection,
          seedK: seedK ?? null
        }
      };
    }
    return next;
  });

  ranked.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  return {
    entries: ranked,
    stats: {
      workUnitsUsed: budget.getUsed(),
      truncated: budget.getUsed() >= maxGraphWorkUnits
    }
  };
};
