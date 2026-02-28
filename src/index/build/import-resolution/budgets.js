import { sortStrings } from './path-utils.js';

const DEFAULT_MAX_FILESYSTEM_PROBES_PER_SPECIFIER = 32;
const DEFAULT_MAX_FALLBACK_CANDIDATES_PER_SPECIFIER = 48;
const MAX_BUDGET_VALUE = 4096;

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

const buildBudgetFingerprint = (policy) => {
  const entries = Object.entries(policy)
    .filter(([key]) => key !== 'version')
    .sort((a, b) => sortStrings(a[0], b[0]))
    .map(([key, value]) => `${key}:${value}`);
  return `import-resolution-budgets-v1|${entries.join('|')}`;
};

export const createImportResolutionBudgetPolicy = ({ resolverPlugins = null } = {}) => {
  const config = normalizeBudgetConfig(resolverPlugins);
  const policy = {
    version: 'import-resolution-budgets-v1',
    maxFilesystemProbesPerSpecifier: coerceBudget(
      config.maxFilesystemProbesPerSpecifier ?? config.maxFsProbesPerSpecifier,
      DEFAULT_MAX_FILESYSTEM_PROBES_PER_SPECIFIER
    ),
    maxFallbackCandidatesPerSpecifier: coerceBudget(
      config.maxFallbackCandidatesPerSpecifier ?? config.maxRelativeCandidatesPerSpecifier,
      DEFAULT_MAX_FALLBACK_CANDIDATES_PER_SPECIFIER
    )
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

  return Object.freeze({
    consumeFilesystemProbe,
    consumeFallbackCandidate,
    isExhausted: () => exhaustedTypes.size > 0,
    exhaustedTypes: () => Array.from(exhaustedTypes.values()).sort(sortStrings)
  });
};
