import { MAX_JSON_BYTES } from '../../shared/artifact-io.js';
import { log } from '../../shared/progress.js';
import { formatBytes } from './artifacts/helpers.js';

const isObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeOverflow = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (['fail', 'abort', 'warn', 'trim', 'shard', 'drop', 'skip'].includes(text)) {
    return text;
  }
  return null;
};

const normalizeMaxBytes = (value, maxJsonBytes) => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (!text) return null;
    if (text === 'auto' || text === 'maxjsonbytes' || text === 'max_json_bytes') {
      return maxJsonBytes;
    }
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

export const DEFAULT_BYTE_BUDGETS = {
  chunk_meta: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  file_meta: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  token_postings: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  repo_map: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  file_relations: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  vfs_manifest: { maxBytes: 'maxJsonBytes', overflow: 'fail' },
  symbol_occurrences: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  symbol_edges: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  call_sites: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  chunk_uid_map: { maxBytes: 'maxJsonBytes', overflow: 'shard' },
  graph_relations: { maxBytes: 'maxJsonBytes', overflow: 'drop' }
};

const resolveOverrides = (indexingConfig) => {
  const artifactConfig = indexingConfig?.artifacts || {};
  const policy = isObject(artifactConfig.byteBudgetPolicy) ? artifactConfig.byteBudgetPolicy : null;
  const overrides = isObject(artifactConfig.byteBudgets)
    ? artifactConfig.byteBudgets
    : (isObject(artifactConfig.byteBudget)
      ? artifactConfig.byteBudget
      : (policy && isObject(policy.artifacts)
        ? policy.artifacts
        : (policy && Object.keys(policy).length && !('strict' in policy) ? policy : {})));
  const strict = artifactConfig.byteBudgetStrict === true
    || artifactConfig.byteBudgetsStrict === true
    || policy?.strict === true;
  return { overrides: overrides || {}, strict };
};

export const resolveByteBudget = ({
  artifact,
  maxJsonBytes = MAX_JSON_BYTES,
  overrides = null,
  strict = false
} = {}) => {
  const defaults = DEFAULT_BYTE_BUDGETS[artifact] || { maxBytes: maxJsonBytes, overflow: 'warn' };
  const override = overrides && Object.prototype.hasOwnProperty.call(overrides, artifact)
    ? overrides[artifact]
    : null;
  let overrideMax = null;
  let overrideOverflow = null;
  let overrideStrict = null;
  if (Number.isFinite(Number(override))) {
    overrideMax = normalizeMaxBytes(override, maxJsonBytes);
  } else if (isObject(override)) {
    overrideMax = normalizeMaxBytes(
      override.maxBytes ?? override.maxJsonBytes ?? override.limitBytes,
      maxJsonBytes
    );
    overrideOverflow = normalizeOverflow(override.overflow);
    overrideStrict = override.strict === true;
  }
  const maxBytes = normalizeMaxBytes(overrideMax ?? defaults.maxBytes, maxJsonBytes);
  const overflow = overrideOverflow || normalizeOverflow(defaults.overflow) || 'warn';
  const resolvedStrict = overrideStrict === true ? true : !!strict;
  return {
    artifact,
    maxBytes,
    overflow,
    strict: resolvedStrict
  };
};

export const resolveByteBudgetMap = ({
  indexingConfig,
  maxJsonBytes = MAX_JSON_BYTES
} = {}) => {
  const { overrides, strict } = resolveOverrides(indexingConfig);
  const keys = new Set([
    ...Object.keys(DEFAULT_BYTE_BUDGETS),
    ...Object.keys(overrides || {})
  ]);
  const budgets = {};
  for (const key of keys) {
    budgets[key] = resolveByteBudget({
      artifact: key,
      maxJsonBytes,
      overrides,
      strict
    });
  }
  return {
    strict,
    policies: budgets
  };
};

export const applyByteBudget = ({
  budget,
  totalBytes,
  label,
  stageCheckpoints = null,
  logger = log
} = {}) => {
  if (!budget || !Number.isFinite(totalBytes)) return null;
  const limit = Number.isFinite(budget.maxBytes) ? budget.maxBytes : null;
  if (!limit || limit <= 0) return null;
  const overBytes = totalBytes - limit;
  const info = {
    limitBytes: limit,
    usedBytes: totalBytes,
    overBytes: Math.max(0, overBytes),
    overflow: budget.overflow || null
  };
  if (stageCheckpoints?.record) {
    stageCheckpoints.record({
      stage: 'artifacts',
      step: 'byte-budget',
      label: label || budget.artifact || null,
      extra: { budget: info }
    });
  }
  if (overBytes > 0) {
    const message = `${label || budget.artifact || 'artifact'} exceeded budget ` +
      `${formatBytes(limit)} by ${formatBytes(overBytes)} (${budget.overflow || 'warn'}).`;
    if (budget.strict || budget.overflow === 'fail' || budget.overflow === 'abort') {
      const err = new Error(message);
      err.code = 'ERR_BYTE_BUDGET';
      throw err;
    }
    if (typeof logger === 'function') {
      logger(`[budget] ${message}`);
    }
  }
  return info;
};

