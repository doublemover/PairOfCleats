import { treeSitterState } from '../state.js';

const DEFAULT_MAX_AST_NODES = 250_000;
const DEFAULT_MAX_AST_STACK = 250_000;
const DEFAULT_MAX_CHUNK_NODES = 5_000;
const JS_TS_LANGUAGE_IDS = new Set(['javascript', 'typescript', 'tsx', 'jsx']);
const DEFAULT_DENSE_NODE_THRESHOLD = 250;
const DEFAULT_DENSER_NODE_THRESHOLD = 600;
const DEFAULT_DENSE_SCALE = 0.5;
const DEFAULT_DENSER_SCALE = 0.25;
const MIN_ADAPTIVE_AST_NODES = 10_000;
const MIN_ADAPTIVE_AST_STACK = 10_000;
const MIN_ADAPTIVE_CHUNK_NODES = 200;

/**
 * Resolve adaptive budget scale from historical node-density telemetry.
 * @param {object} options
 * @param {string} resolvedId
 * @returns {{scale:number,density:number|null}}
 */
const resolveAdaptiveBudgetScale = (options, resolvedId) => {
  const adaptive = options?.treeSitter?.adaptive;
  if (adaptive === false || adaptive?.enabled === false) return { scale: 1, density: null };
  const entry = treeSitterState.nodeDensity?.get?.(resolvedId);
  const density = entry && typeof entry === 'object' ? entry.density : entry;
  if (!Number.isFinite(density) || density <= 0) return { scale: 1, density: null };

  const denseThreshold = Number.isFinite(adaptive?.denseThreshold)
    ? adaptive.denseThreshold
    : DEFAULT_DENSE_NODE_THRESHOLD;
  const denserThreshold = Number.isFinite(adaptive?.denserThreshold)
    ? adaptive.denserThreshold
    : DEFAULT_DENSER_NODE_THRESHOLD;
  const denseScale = Number.isFinite(adaptive?.denseScale)
    ? adaptive.denseScale
    : DEFAULT_DENSE_SCALE;
  const denserScale = Number.isFinite(adaptive?.denserScale)
    ? adaptive.denserScale
    : DEFAULT_DENSER_SCALE;

  let scale = 1;
  if (Number.isFinite(denserThreshold) && density >= denserThreshold) {
    scale = denserScale;
  } else if (Number.isFinite(denseThreshold) && density >= denseThreshold) {
    scale = denseScale;
  }

  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  if (scale < 1 && options?.log && !treeSitterState.loggedAdaptiveBudgets?.has?.(resolvedId)) {
    options.log(
      `[tree-sitter] Dense AST for ${resolvedId} (${density.toFixed(1)} nodes/line); ` +
      `scaling traversal budgets by ${scale}.`
    );
    treeSitterState.loggedAdaptiveBudgets?.add?.(resolvedId);
  }

  return { scale, density };
};

/**
 * Apply adaptive budget scaling with lower safety floors.
 * @param {{maxAstNodes:number,maxAstStack:number,maxChunkNodes:number}} budget
 * @param {object} options
 * @param {string} resolvedId
 * @param {(key:string,amount?:number)=>void|null} [bumpMetric=null]
 * @returns {{maxAstNodes:number,maxAstStack:number,maxChunkNodes:number}}
 */
const applyAdaptiveBudget = (budget, options, resolvedId, bumpMetric = null) => {
  const { scale } = resolveAdaptiveBudgetScale(options, resolvedId);
  if (!Number.isFinite(scale) || scale >= 1) return budget;
  if (typeof bumpMetric === 'function') bumpMetric('adaptiveBudgetCuts', 1);
  const clamp = (value, min) => {
    const base = Number.isFinite(value) ? value : min;
    const scaled = Math.floor(base * scale);
    const floor = Math.min(base, min);
    return Math.max(floor, scaled);
  };
  return {
    maxAstNodes: clamp(budget.maxAstNodes, MIN_ADAPTIVE_AST_NODES),
    maxAstStack: clamp(budget.maxAstStack, MIN_ADAPTIVE_AST_STACK),
    maxChunkNodes: clamp(budget.maxChunkNodes, MIN_ADAPTIVE_CHUNK_NODES)
  };
};

/**
 * Record smoothed AST node-density telemetry for adaptive budgets.
 * @param {string} languageId
 * @param {number} visited
 * @param {number} lineCount
 * @returns {{density:number,samples:number}|null}
 */
export function recordNodeDensity(languageId, visited, lineCount) {
  if (!languageId) return null;
  if (!Number.isFinite(visited) || visited <= 0) return null;
  if (!Number.isFinite(lineCount) || lineCount <= 0) return null;
  const density = visited / Math.max(1, lineCount);
  const prev = treeSitterState.nodeDensity?.get?.(languageId);
  const prevDensity = prev && typeof prev === 'object' ? prev.density : prev;
  const prevSamples = prev && typeof prev === 'object' ? prev.samples : 0;
  const nextDensity = Number.isFinite(prevDensity)
    ? (prevDensity * 0.7) + (density * 0.3)
    : density;
  const next = { density: nextDensity, samples: prevSamples + 1 };
  treeSitterState.nodeDensity?.set?.(languageId, next);
  return next;
}

/**
 * Resolve traversal budgets from config, language defaults, and adaptive scale.
 * @param {object} options
 * @param {string} resolvedId
 * @param {{bumpMetric?:(key:string,amount?:number)=>void}} [helpers]
 * @returns {{maxAstNodes:number,maxAstStack:number,maxChunkNodes:number}}
 */
export function resolveTraversalBudget(options, resolvedId, { bumpMetric = null } = {}) {
  const config = options?.treeSitter || {};
  const perLanguage = config.byLanguage?.[resolvedId] || {};
  const isJsTs = JS_TS_LANGUAGE_IDS.has(resolvedId);
  const defaultMaxChunkNodes = isJsTs ? 1_000 : DEFAULT_MAX_CHUNK_NODES;
  const maxAstNodes = perLanguage.maxAstNodes ?? config.maxAstNodes ?? DEFAULT_MAX_AST_NODES;
  const maxAstStack = perLanguage.maxAstStack ?? config.maxAstStack ?? DEFAULT_MAX_AST_STACK;
  const maxChunkNodes = perLanguage.maxChunkNodes ?? config.maxChunkNodes ?? defaultMaxChunkNodes;
  const budget = {
    maxAstNodes: Number.isFinite(maxAstNodes) && maxAstNodes > 0 ? Math.floor(maxAstNodes) : DEFAULT_MAX_AST_NODES,
    maxAstStack: Number.isFinite(maxAstStack) && maxAstStack > 0 ? Math.floor(maxAstStack) : DEFAULT_MAX_AST_STACK,
    maxChunkNodes: Number.isFinite(maxChunkNodes) && maxChunkNodes > 0 ? Math.floor(maxChunkNodes) : defaultMaxChunkNodes
  };
  return applyAdaptiveBudget(budget, options, resolvedId, bumpMetric);
}
