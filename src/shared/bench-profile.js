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

const BENCH_PROFILE_KEYS = new Set(['bench', 'bench-index', 'bench-hybrid', 'bench-dense']);

function resolveProfileFlags() {
  return { ...DEFAULT_PROFILE_FLAGS };
}

const normalizeProfileName = (value) => {
  if (!value) return '';
  return String(value).trim().toLowerCase();
};

const isBenchProfileName = (value) => {
  const normalized = normalizeProfileName(value);
  if (!normalized) return false;
  if (BENCH_PROFILE_KEYS.has(normalized)) return true;
  return normalized.startsWith('bench-');
};

export function resolveBenchmarkProfile(profileName = '') {
  const enabled = isBenchProfileName(profileName);
  const flags = resolveProfileFlags();
  const disabled = enabled
    ? PROFILE_FLAG_ORDER.filter((entry) => flags[entry.key]).map((entry) => entry.label)
    : [];
  return { enabled, flags, disabled };
}

export function applyBenchmarkProfile(indexingConfig = {}, profileName = '') {
  const profile = resolveBenchmarkProfile(profileName);
  if (!profile.enabled) {
    return { indexingConfig, profile };
  }
  const next = { ...indexingConfig };
  if (profile.flags.disableGitBlame) next.gitBlame = true;
  if (profile.flags.disableLint) next.lint = true;
  if (profile.flags.disableComplexity) next.complexity = true;
  if (profile.flags.disableRisk) {
    next.riskAnalysis = true;
    next.riskAnalysisCrossFile = true;
  }
  if (profile.flags.disableTypeInference) {
    next.typeInference = true;
    next.typeInferenceCrossFile = true;
  }
  if (profile.flags.disableChargrams) {
    next.postings = { ...(next.postings || {}), enableChargrams: true };
  }
  return { indexingConfig: next, profile };
}
