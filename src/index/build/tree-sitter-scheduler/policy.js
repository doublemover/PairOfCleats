import { toPosix } from '../../../shared/files.js';
import { isDocsPath, shouldPreferInfraProse } from '../mode-routing.js';

const DOC_TREE_SITTER_SKIP_LANGUAGES = new Set([
  'yaml',
  'json',
  'toml',
  'markdown',
  'html',
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'css'
]);

const HEAVY_TREE_SITTER_PATH_PARTS = [
  '/3rdparty/',
  '/include/fmt/',
  '/include/spdlog/fmt/',
  '/include/nlohmann/',
  '/single_include/nlohmann/',
  '/modules/core/include/opencv2/core/hal/',
  '/modules/core/src/',
  '/modules/dnn/',
  '/modules/js/perf/',
  '/sources/cniollhttp/',
  '/sources/nio/',
  '/sources/niocore/',
  '/sources/nioposix/',
  '/tests/nio/',
  '/tests/abi/',
  '/test/api-digester/inputs/',
  '/test/remote-run/',
  '/test/stdlib/inputs/',
  '/test/gtest/',
  '/contrib/minizip/',
  '/utils/unicodedata/',
  '/utils/gen-unicode-data/',
  '/samples/',
  '/docs/mkdocs/'
];

const HEAVY_TREE_SITTER_LANGUAGES = new Set([
  'clike',
  'cpp',
  'objc',
  'swift',
  'cmake',
  'javascript',
  'typescript',
  'jsx',
  'tsx'
]);

const HIGH_CARDINALITY_MIN_JOBS_DEFAULT = 48;
const HIGH_CARDINALITY_MIN_COST_DEFAULT = 8000;
const HIGH_CARDINALITY_SKEW_RATIO_DEFAULT = 1.75;
const LANE_SPLIT_IMBALANCE_RATIO_DEFAULT = 1.35;
const LANE_MERGE_IMBALANCE_RATIO_DEFAULT = 1.12;
const LANE_TAIL_SPLIT_MS_DEFAULT = 1800;
const LANE_COOLDOWN_STEPS_DEFAULT = 3;
const LANE_MAX_STEP_UP_DEFAULT = 2;
const LANE_MAX_STEP_DOWN_DEFAULT = 1;
const LANE_SPLIT_HYSTERESIS_RATIO_DEFAULT = 1.18;
const LANE_MERGE_HYSTERESIS_RATIO_DEFAULT = 0.72;

const coercePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

const coercePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

/**
 * Resolve scheduler lane split/merge guardrails with safe defaults.
 *
 * @param {object} schedulerConfig
 * @returns {{
 *  highCardinalityMinJobs:number,
 *  highCardinalityMinCost:number,
 *  highCardinalitySkewRatio:number,
 *  splitImbalanceRatio:number,
 *  mergeImbalanceRatio:number,
 *  tailSplitMs:number,
 *  cooldownSteps:number,
 *  maxStepUp:number,
 *  maxStepDown:number,
 *  splitHysteresisRatio:number,
 *  mergeHysteresisRatio:number
 * }}
 */
export const resolveTreeSitterLaneGuardrails = (schedulerConfig = {}) => {
  const splitHysteresisRatio = coercePositiveNumber(
    schedulerConfig?.laneSplitHysteresisRatio,
    LANE_SPLIT_HYSTERESIS_RATIO_DEFAULT
  );
  let mergeHysteresisRatio = coercePositiveNumber(
    schedulerConfig?.laneMergeHysteresisRatio,
    LANE_MERGE_HYSTERESIS_RATIO_DEFAULT
  );
  if (mergeHysteresisRatio >= splitHysteresisRatio) {
    mergeHysteresisRatio = Math.max(0.5, splitHysteresisRatio * 0.65);
  }
  return {
    highCardinalityMinJobs: coercePositiveInt(
      schedulerConfig?.highCardinalityMinJobs,
      HIGH_CARDINALITY_MIN_JOBS_DEFAULT
    ),
    highCardinalityMinCost: coercePositiveNumber(
      schedulerConfig?.highCardinalityMinCost,
      HIGH_CARDINALITY_MIN_COST_DEFAULT
    ),
    highCardinalitySkewRatio: coercePositiveNumber(
      schedulerConfig?.highCardinalitySkewRatio,
      HIGH_CARDINALITY_SKEW_RATIO_DEFAULT
    ),
    splitImbalanceRatio: coercePositiveNumber(
      schedulerConfig?.laneSplitImbalanceRatio,
      LANE_SPLIT_IMBALANCE_RATIO_DEFAULT
    ),
    mergeImbalanceRatio: coercePositiveNumber(
      schedulerConfig?.laneMergeImbalanceRatio,
      LANE_MERGE_IMBALANCE_RATIO_DEFAULT
    ),
    tailSplitMs: coercePositiveNumber(
      schedulerConfig?.laneTailSplitMs,
      LANE_TAIL_SPLIT_MS_DEFAULT
    ),
    cooldownSteps: coercePositiveInt(
      schedulerConfig?.laneCooldownSteps,
      LANE_COOLDOWN_STEPS_DEFAULT
    ),
    maxStepUp: coercePositiveInt(
      schedulerConfig?.laneMaxStepUp,
      LANE_MAX_STEP_UP_DEFAULT
    ),
    maxStepDown: coercePositiveInt(
      schedulerConfig?.laneMaxStepDown,
      LANE_MAX_STEP_DOWN_DEFAULT
    ),
    splitHysteresisRatio,
    mergeHysteresisRatio
  };
};

/**
 * Determine whether a grammar workload should use high-cardinality fanout.
 * This is intentionally grammar-agnostic; volume/skew/tail characteristics
 * control the decision.
 *
 * @param {{
 *  schedulerConfig?:object,
 *  jobCount?:number,
 *  totalEstimatedCost?:number,
 *  skewRatio?:number,
 *  tailDurationMs?:number
 * }} input
 * @returns {boolean}
 */
export const isHighCardinalityTreeSitterGrammar = ({
  schedulerConfig = {},
  jobCount = 0,
  totalEstimatedCost = 0,
  skewRatio = 0,
  tailDurationMs = 0
}) => {
  const guardrails = resolveTreeSitterLaneGuardrails(schedulerConfig);
  const normalizedJobs = Number.isFinite(Number(jobCount)) ? Number(jobCount) : 0;
  const normalizedCost = Number.isFinite(Number(totalEstimatedCost)) ? Number(totalEstimatedCost) : 0;
  const normalizedSkew = Number.isFinite(Number(skewRatio)) ? Number(skewRatio) : 0;
  const normalizedTailMs = Number.isFinite(Number(tailDurationMs)) ? Number(tailDurationMs) : 0;
  const hasVolume = normalizedJobs >= guardrails.highCardinalityMinJobs
    || normalizedCost >= guardrails.highCardinalityMinCost;
  if (!hasVolume) return false;
  if (normalizedJobs >= Math.ceil(guardrails.highCardinalityMinJobs * 1.25)) return true;
  if (normalizedCost >= (guardrails.highCardinalityMinCost * 1.25)) return true;
  if (normalizedSkew >= guardrails.highCardinalitySkewRatio) return true;
  if (normalizedTailMs >= guardrails.tailSplitMs) return true;
  if (normalizedJobs >= (guardrails.highCardinalityMinJobs * 2)) return true;
  if (normalizedCost >= (guardrails.highCardinalityMinCost * 2)) return true;
  return false;
};

/**
 * Detect vendor-generated docset mirrors where tree-sitter parsing is mostly
 * low-value and expensive.
 *
 * @param {string} relKey
 * @returns {boolean}
 */
export const isGeneratedTreeSitterPath = (relKey) => {
  if (!relKey) return false;
  const normalized = toPosix(String(relKey)).toLowerCase();
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  if (bounded.includes('/.docset/contents/resources/documents/')) return true;
  if (bounded.includes('/docsets/') && bounded.includes('/contents/resources/documents/')) return true;
  if (bounded.includes('/docs/docset/contents/resources/documents/')) return true;
  return false;
};

/**
 * Centralized skip policy used by planner prefiltering and runtime scheduling.
 *
 * @param {{relKey:string,languageId?:string|null}} input
 * @returns {boolean}
 */
export const shouldSkipTreeSitterPlanningForPath = ({ relKey, languageId }) => {
  if (!relKey) return false;
  const normalizedLanguageId = languageId || '';
  if (isGeneratedTreeSitterPath(relKey)) return true;
  if (shouldPreferInfraProse({ relPath: relKey })) return true;
  if (isDocsPath(relKey) && DOC_TREE_SITTER_SKIP_LANGUAGES.has(normalizedLanguageId)) return true;
  if (!HEAVY_TREE_SITTER_LANGUAGES.has(normalizedLanguageId)) return false;
  const normalized = toPosix(String(relKey)).toLowerCase();
  const bounded = `/${normalized.replace(/^\/+|\/+$/g, '')}/`;
  for (const part of HEAVY_TREE_SITTER_PATH_PARTS) {
    if (bounded.includes(part)) return true;
  }
  return false;
};
