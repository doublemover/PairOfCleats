import { normalizeOptionalNumber } from '../../shared/limits.js';

const DEFAULT_MAX_WORK_UNITS = 500;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_WIDTH_PER_NODE = 12;
const DEFAULT_MAX_VISITED_NODES = 192;

const normalizeSeedSelection = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'topk') return 'topK';
  if (raw === 'top1' || raw === 'topk' || raw === 'none') return raw;
  return 'top1';
};

const normalizeBoundedInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = normalizeOptionalNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return Math.min(max, Math.max(min, rounded));
};

/**
 * Resolve bounded multi-hop defaults for graph ranking expansion.
 * @param {object|null|undefined} expansion
 * @returns {{maxDepth:number,maxWidthPerNode:number,maxVisitedNodes:number}}
 */
const normalizeExpansionPolicy = (expansion) => ({
  maxDepth: normalizeBoundedInt(expansion?.maxDepth, DEFAULT_MAX_DEPTH, { min: 1, max: 4 }),
  maxWidthPerNode: normalizeBoundedInt(expansion?.maxWidthPerNode, DEFAULT_MAX_WIDTH_PER_NODE, { min: 1, max: 64 }),
  maxVisitedNodes: normalizeBoundedInt(expansion?.maxVisitedNodes, DEFAULT_MAX_VISITED_NODES, { min: 8, max: 2048 })
});

/** Shared effective policy for execution and query-plan identity. */
export const resolveGraphRankingPolicy = config => ({
  enabled: config?.enabled === true,
  degreeWeight: Number(config?.weights?.degree) || 0,
  proximityWeight: Number(config?.weights?.proximity) || 0,
  seedSelection: normalizeSeedSelection(config?.seedSelection),
  seedK: normalizeOptionalNumber(config?.seedK),
  maxGraphWorkUnits: normalizeOptionalNumber(config?.maxGraphWorkUnits) ?? DEFAULT_MAX_WORK_UNITS,
  maxWallClockMs: normalizeOptionalNumber(config?.maxWallClockMs),
  expansionPolicy: normalizeExpansionPolicy(config?.expansion)
});
