import { sortStrings } from './path-utils.js';

const DEFAULT_MAX_FILESYSTEM_PROBES_PER_SPECIFIER = 32;
const DEFAULT_MAX_FALLBACK_CANDIDATES_PER_SPECIFIER = 48;
const DEFAULT_MAX_FALLBACK_DEPTH = 16;
const MAX_BUDGET_VALUE = 4096;
const MIN_ADAPTIVE_SCALE = 0.5;
const MAX_ADAPTIVE_SCALE = 2;
const DEFAULT_ADAPTIVE_SCALE = 1;
const DEFAULT_ADAPTIVE_PROFILE = 'normal';

const coerceBudget = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.floor(numeric);
  if (rounded < 0) return 0;
  return Math.min(MAX_BUDGET_VALUE, rounded);
};

const normalizeBudgetConfig = (resolverPlugins) => {
  if (!resolverPlugins || typeof resolverPlugins !== 'object') return {};
  const direct = resolverPlugins.budgets;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
  const buildContext = resolverPlugins.buildContext;
  if (buildContext && typeof buildContext === 'object' && !Array.isArray(buildContext)) {
    const nested = buildContext.budgets;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
  }
  return {};
};

const clampRatio = (value, fallback = null) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
};

const clampAdaptiveScale = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ADAPTIVE_SCALE;
  return Math.max(MIN_ADAPTIVE_SCALE, Math.min(MAX_ADAPTIVE_SCALE, numeric));
};

const toPositiveIntOrNull = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
};

const hasExplicitBudgetValue = (config, keys) => keys.some((key) => (
  Object.prototype.hasOwnProperty.call(config, key)
));

const resolveAdaptiveBudgetSignals = (runtimeSignals) => {
  const scheduler = runtimeSignals?.scheduler && typeof runtimeSignals.scheduler === 'object'
    ? runtimeSignals.scheduler
    : {};
  const envelope = runtimeSignals?.envelope && typeof runtimeSignals.envelope === 'object'
    ? runtimeSignals.envelope
    : {};
  const utilizationOverall = clampRatio(
    scheduler.utilizationOverall ?? scheduler.utilization ?? scheduler.overallUtilization,
    null
  );
  const memoryPressure = clampRatio(
    scheduler.memoryPressure ?? scheduler.memoryPressureScore,
    null
  );
  const fdPressure = clampRatio(
    scheduler.fdPressure ?? scheduler.fdPressureScore,
    null
  );
  const pending = Math.max(0, Math.floor(Number(scheduler.pending) || 0));
  const running = Math.max(0, Math.floor(Number(scheduler.running) || 0));
  const demand = pending + running;
  const cpuConcurrency = toPositiveIntOrNull(envelope.cpuConcurrency) || 0;
  const ioConcurrency = toPositiveIntOrNull(envelope.ioConcurrency) || 0;
  const hostConcurrency = Math.max(cpuConcurrency, ioConcurrency);
  return {
    utilizationOverall,
    memoryPressure,
    fdPressure,
    pending,
    running,
    demand,
    hostConcurrency
  };
};

const resolveAdaptiveBudgetProfile = (runtimeSignals) => {
  const signals = resolveAdaptiveBudgetSignals(runtimeSignals);
  const {
    utilizationOverall,
    memoryPressure,
    fdPressure,
    pending,
    demand,
    hostConcurrency
  } = signals;
  const pressureCritical = (
    (memoryPressure != null && memoryPressure >= 0.9)
    || (fdPressure != null && fdPressure >= 0.9)
  );
  const pressureHigh = (
    (memoryPressure != null && memoryPressure >= 0.8)
    || (fdPressure != null && fdPressure >= 0.8)
  );
  const backlogHigh = pending >= 96;
  const backlogMedium = pending >= 48;
  const utilizationLow = utilizationOverall != null && utilizationOverall < 0.6;
  const utilizationVeryLow = utilizationOverall != null && utilizationOverall < 0.35;
  const utilizationHigh = utilizationOverall != null && utilizationOverall >= 0.85;

  let profile = DEFAULT_ADAPTIVE_PROFILE;
  let pressureMultiplier = DEFAULT_ADAPTIVE_SCALE;
  if (pressureCritical) {
    profile = 'pressure_critical';
    pressureMultiplier = 0.5;
  } else if (pressureHigh) {
    profile = 'pressure_high';
    pressureMultiplier = 0.7;
  } else if (utilizationVeryLow && backlogHigh) {
    profile = 'queue_backlog_underutilized';
    pressureMultiplier = 0.65;
  } else if (utilizationLow && backlogMedium) {
    profile = 'queue_backlog';
    pressureMultiplier = 0.8;
  } else if (utilizationHigh && demand <= 16) {
    profile = 'capacity_headroom';
    pressureMultiplier = 1.25;
  }

  const hostMultiplier = hostConcurrency > 0
    ? Math.max(0.75, Math.min(1.5, hostConcurrency / 8))
    : 1;
  const scale = clampAdaptiveScale(pressureMultiplier * hostMultiplier);
  return {
    profile,
    scale
  };
};

const applyAdaptiveScale = (baseBudget, adaptiveScale, depthWeighted = false) => {
  const base = Math.max(0, Math.floor(Number(baseBudget) || 0));
  if (base <= 0) return 0;
  const effectiveScale = depthWeighted
    ? (1 + ((adaptiveScale - 1) * 0.5))
    : adaptiveScale;
  const scaled = Math.round(base * effectiveScale);
  return coerceBudget(scaled, base);
};

const buildBudgetFingerprint = (policy) => {
  const fingerprintKeys = [
    'maxFilesystemProbesPerSpecifier',
    'maxFallbackCandidatesPerSpecifier',
    'maxFallbackDepth'
  ];
  const entries = fingerprintKeys
    .map((key) => [key, policy?.[key]])
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => sortStrings(a[0], b[0]))
    .map(([key, value]) => `${key}:${value}`);
  return `import-resolution-budgets-v2|${entries.join('|')}`;
};

export const createImportResolutionBudgetPolicy = ({
  resolverPlugins = null,
  runtimeSignals = null
} = {}) => {
  const config = normalizeBudgetConfig(resolverPlugins);
  const adaptiveEnabled = config.adaptive !== false;
  const adaptive = adaptiveEnabled
    ? resolveAdaptiveBudgetProfile(runtimeSignals)
    : {
      profile: 'disabled',
      scale: DEFAULT_ADAPTIVE_SCALE
    };
  const explicitFsProbes = hasExplicitBudgetValue(
    config,
    ['maxFilesystemProbesPerSpecifier', 'maxFsProbesPerSpecifier']
  );
  const explicitFallbackCandidates = hasExplicitBudgetValue(
    config,
    ['maxFallbackCandidatesPerSpecifier', 'maxRelativeCandidatesPerSpecifier']
  );
  const explicitFallbackDepth = hasExplicitBudgetValue(config, ['maxFallbackDepth']);
  const fsBase = coerceBudget(
    config.maxFilesystemProbesPerSpecifier ?? config.maxFsProbesPerSpecifier,
    DEFAULT_MAX_FILESYSTEM_PROBES_PER_SPECIFIER
  );
  const fallbackCandidatesBase = coerceBudget(
    config.maxFallbackCandidatesPerSpecifier ?? config.maxRelativeCandidatesPerSpecifier,
    DEFAULT_MAX_FALLBACK_CANDIDATES_PER_SPECIFIER
  );
  const fallbackDepthBase = coerceBudget(
    config.maxFallbackDepth,
    DEFAULT_MAX_FALLBACK_DEPTH
  );
  const policy = {
    version: 'import-resolution-budgets-v2',
    maxFilesystemProbesPerSpecifier: (adaptiveEnabled && !explicitFsProbes)
      ? applyAdaptiveScale(fsBase, adaptive.scale)
      : fsBase,
    maxFallbackCandidatesPerSpecifier: (adaptiveEnabled && !explicitFallbackCandidates)
      ? applyAdaptiveScale(fallbackCandidatesBase, adaptive.scale)
      : fallbackCandidatesBase,
    maxFallbackDepth: (adaptiveEnabled && !explicitFallbackDepth)
      ? applyAdaptiveScale(fallbackDepthBase, adaptive.scale, true)
      : fallbackDepthBase,
    adaptiveEnabled,
    adaptiveProfile: adaptive.profile,
    adaptiveScale: Number(adaptive.scale.toFixed(3))
  };
  return Object.freeze({
    ...policy,
    fingerprint: buildBudgetFingerprint(policy)
  });
};

export const createImportResolutionSpecifierBudgetState = (policy) => {
  const maxFilesystemProbesPerSpecifier = coerceBudget(
    policy?.maxFilesystemProbesPerSpecifier,
    DEFAULT_MAX_FILESYSTEM_PROBES_PER_SPECIFIER
  );
  const maxFallbackCandidatesPerSpecifier = coerceBudget(
    policy?.maxFallbackCandidatesPerSpecifier,
    DEFAULT_MAX_FALLBACK_CANDIDATES_PER_SPECIFIER
  );
  const maxFallbackDepth = coerceBudget(
    policy?.maxFallbackDepth,
    DEFAULT_MAX_FALLBACK_DEPTH
  );
  let filesystemProbesRemaining = maxFilesystemProbesPerSpecifier;
  let fallbackCandidatesRemaining = maxFallbackCandidatesPerSpecifier;
  const exhaustedTypes = new Set();

  const consumeFilesystemProbe = () => {
    if (filesystemProbesRemaining <= 0) {
      exhaustedTypes.add('filesystem_probe');
      return false;
    }
    filesystemProbesRemaining -= 1;
    return true;
  };

  const consumeFallbackCandidate = () => {
    if (fallbackCandidatesRemaining <= 0) {
      exhaustedTypes.add('fallback_candidates');
      return false;
    }
    fallbackCandidatesRemaining -= 1;
    return true;
  };

  const allowFallbackDepth = (depth) => {
    const normalizedDepth = Math.max(0, Math.floor(Number(depth) || 0));
    if (normalizedDepth <= maxFallbackDepth) return true;
    exhaustedTypes.add('fallback_depth');
    return false;
  };

  return Object.freeze({
    consumeFilesystemProbe,
    consumeFallbackCandidate,
    allowFallbackDepth,
    isExhausted: () => exhaustedTypes.size > 0,
    exhaustedTypes: () => Array.from(exhaustedTypes.values()).sort(sortStrings)
  });
};
