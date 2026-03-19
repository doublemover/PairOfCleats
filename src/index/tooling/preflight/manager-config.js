import {
  normalizePreflightPolicy,
  PREFLIGHT_POLICY
} from '../provider-contract.js';

export const PREFLIGHT_CLASS = Object.freeze({
  PROBE: 'probe',
  WORKSPACE: 'workspace',
  DEPENDENCY: 'dependency'
});

const PREFLIGHT_CLASS_SET = new Set(Object.values(PREFLIGHT_CLASS));

const DEFAULT_PREFLIGHT_TIMEOUT_BY_CLASS_MS = Object.freeze({
  [PREFLIGHT_CLASS.PROBE]: 5000,
  [PREFLIGHT_CLASS.WORKSPACE]: 20000,
  [PREFLIGHT_CLASS.DEPENDENCY]: 90000
});

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 20000;
const MIN_PREFLIGHT_TIMEOUT_MS = 250;
const MAX_PREFLIGHT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_PREFLIGHT_MAX_CONCURRENCY = 4;
const MIN_PREFLIGHT_MAX_CONCURRENCY = 1;
const MAX_PREFLIGHT_MAX_CONCURRENCY = 16;

const clampInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const toPositiveIntOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const floored = Math.floor(parsed);
  return floored > 0 ? floored : null;
};

export const normalizePreflightClass = (value, fallback = PREFLIGHT_CLASS.PROBE) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (PREFLIGHT_CLASS_SET.has(normalized)) return normalized;
  return fallback;
};

export const resolveProviderPreflightClass = (provider) => {
  const explicit = normalizePreflightClass(provider?.preflightClass || '', '');
  if (explicit) return explicit;
  const preflightId = String(provider?.preflightId || '').trim().toLowerCase();
  if (preflightId.includes('dependency') || preflightId.includes('package') || preflightId.includes('bootstrap')) {
    return PREFLIGHT_CLASS.DEPENDENCY;
  }
  if (preflightId.includes('workspace') || preflightId.includes('model')) {
    return PREFLIGHT_CLASS.WORKSPACE;
  }
  if (preflightId.includes('probe')) {
    return PREFLIGHT_CLASS.PROBE;
  }
  return PREFLIGHT_CLASS.PROBE;
};

export const resolveProviderPreflightPolicy = (provider) => (
  normalizePreflightPolicy(provider?.preflightPolicy, PREFLIGHT_POLICY.REQUIRED)
);

export const resolveSchedulerConfig = (ctx) => {
  const preflightConfig = ctx?.toolingConfig?.preflight && typeof ctx.toolingConfig.preflight === 'object'
    ? ctx.toolingConfig.preflight
    : {};
  const maxConcurrency = clampInt(
    preflightConfig.maxConcurrency,
    DEFAULT_PREFLIGHT_MAX_CONCURRENCY,
    MIN_PREFLIGHT_MAX_CONCURRENCY,
    MAX_PREFLIGHT_MAX_CONCURRENCY
  );
  const timeoutByClassRaw = preflightConfig.timeoutMsByClass && typeof preflightConfig.timeoutMsByClass === 'object'
    ? preflightConfig.timeoutMsByClass
    : {};
  const timeoutByClass = {
    [PREFLIGHT_CLASS.PROBE]: toPositiveIntOrNull(timeoutByClassRaw[PREFLIGHT_CLASS.PROBE]),
    [PREFLIGHT_CLASS.WORKSPACE]: toPositiveIntOrNull(timeoutByClassRaw[PREFLIGHT_CLASS.WORKSPACE]),
    [PREFLIGHT_CLASS.DEPENDENCY]: toPositiveIntOrNull(timeoutByClassRaw[PREFLIGHT_CLASS.DEPENDENCY])
  };
  return {
    maxConcurrency,
    timeoutMs: toPositiveIntOrNull(preflightConfig.timeoutMs),
    timeoutByClass
  };
};

export const resolvePreflightTimeoutMs = ({ ctx, provider, preflightClass }) => {
  const config = resolveSchedulerConfig(ctx);
  const providerTimeout = toPositiveIntOrNull(provider?.preflightTimeoutMs);
  const classTimeout = toPositiveIntOrNull(config.timeoutByClass?.[preflightClass]);
  const globalTimeout = toPositiveIntOrNull(config.timeoutMs);
  const fallbackTimeout = toPositiveIntOrNull(DEFAULT_PREFLIGHT_TIMEOUT_BY_CLASS_MS[preflightClass])
    || DEFAULT_PREFLIGHT_TIMEOUT_MS;
  const resolved = providerTimeout || classTimeout || globalTimeout || fallbackTimeout;
  return clampInt(
    resolved,
    fallbackTimeout,
    MIN_PREFLIGHT_TIMEOUT_MS,
    MAX_PREFLIGHT_TIMEOUT_MS
  );
};
