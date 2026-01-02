const DEFAULT_PROFILE_FLAGS = {
  disableGitBlame: true,
  disableLint: true,
  disableComplexity: true,
  disableChargrams: true,
  disableRisk: true,
  disableTypeInference: true
};

const PROFILE_FLAG_ORDER = [
  { key: 'disableGitBlame', label: 'gitBlame' },
  { key: 'disableLint', label: 'lint' },
  { key: 'disableComplexity', label: 'complexity' },
  { key: 'disableChargrams', label: 'chargrams' },
  { key: 'disableRisk', label: 'riskAnalysis' },
  { key: 'disableTypeInference', label: 'typeInference' }
];

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseBool(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function resolveProfileFlags(rawProfile) {
  const flags = { ...DEFAULT_PROFILE_FLAGS };
  if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
    return flags;
  }
  for (const key of Object.keys(DEFAULT_PROFILE_FLAGS)) {
    if (typeof rawProfile[key] === 'boolean') {
      flags[key] = rawProfile[key];
    }
  }
  return flags;
}

export function resolveBenchmarkProfile(indexingConfig = {}, envValue) {
  const rawProfile = indexingConfig.benchmarkProfile;
  const envOverride = parseBool(envValue);
  let enabled = false;
  if (typeof envOverride === 'boolean') {
    enabled = envOverride;
  } else if (typeof rawProfile === 'boolean') {
    enabled = rawProfile;
  } else if (rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)) {
    enabled = rawProfile.enabled === true;
  }
  const flags = resolveProfileFlags(rawProfile);
  const disabled = enabled
    ? PROFILE_FLAG_ORDER.filter((entry) => flags[entry.key]).map((entry) => entry.label)
    : [];
  return {
    enabled,
    flags,
    disabled
  };
}

export function applyBenchmarkProfile(indexingConfig = {}, envValue) {
  const profile = resolveBenchmarkProfile(indexingConfig, envValue);
  if (!profile.enabled) {
    return { indexingConfig, profile };
  }
  const next = { ...indexingConfig };
  if (profile.flags.disableGitBlame) next.gitBlame = false;
  if (profile.flags.disableLint) next.lint = false;
  if (profile.flags.disableComplexity) next.complexity = false;
  if (profile.flags.disableRisk) {
    next.riskAnalysis = false;
    next.riskAnalysisCrossFile = false;
  }
  if (profile.flags.disableTypeInference) {
    next.typeInference = false;
    next.typeInferenceCrossFile = false;
  }
  if (profile.flags.disableChargrams) {
    next.postings = { ...(next.postings || {}), enableChargrams: false };
  }
  return { indexingConfig: next, profile };
}
