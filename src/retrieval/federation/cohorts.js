const KNOWN_MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);

export const FEDERATION_COHORT_WARNINGS = Object.freeze({
  MULTI_COHORT: 'WARN_FEDERATED_MULTI_COHORT',
  UNSAFE_MIXING: 'WARN_FEDERATED_UNSAFE_MIXING'
});

export const FEDERATION_COHORT_ERRORS = Object.freeze({
  MULTI_COHORT: 'ERR_FEDERATED_MULTI_COHORT',
  COHORT_NOT_FOUND: 'ERR_FEDERATED_COHORT_NOT_FOUND'
});

const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const sortByRepoId = (repos) => (
  repos.slice().sort((a, b) => String(a?.repoId || '').localeCompare(String(b?.repoId || '')))
);

const keySort = (left, right) => {
  const a = left == null ? '\uffff' : String(left);
  const b = right == null ? '\uffff' : String(right);
  return a.localeCompare(b);
};

export const resolveEffectiveCohortKey = (repo, mode) => {
  const modeState = repo?.indexes?.[mode] || {};
  const cohortKey = normalizeString(modeState.cohortKey);
  const compatibilityKey = normalizeString(modeState.compatibilityKey);
  return cohortKey || compatibilityKey || null;
};

/**
 * Return whether a repo should participate in cohort selection for one mode.
 *
 * Repos without explicit availability metadata are treated as eligible so
 * existing lightweight fixtures and legacy callers keep previous behavior.
 *
 * @param {any} repo
 * @param {string} mode
 * @returns {boolean}
 */
const isRepoSelectableForMode = (repo, mode) => {
  const modeState = repo?.indexes?.[mode];
  if (!modeState || typeof modeState !== 'object' || Array.isArray(modeState)) {
    return true;
  }
  const hasPresent = Object.prototype.hasOwnProperty.call(modeState, 'present');
  const availabilityReason = normalizeString(modeState.availabilityReason);
  if (!hasPresent && !availabilityReason) {
    return true;
  }
  if (availabilityReason && availabilityReason !== 'present') {
    return false;
  }
  if (hasPresent && modeState.present !== true) {
    return false;
  }
  return true;
};

const parseCohortSelectors = (cohortSelectors) => {
  const selectors = Array.isArray(cohortSelectors)
    ? cohortSelectors
    : (cohortSelectors == null ? [] : [cohortSelectors]);
  const globalSelections = new Set();
  const modeSelections = new Map();
  for (const raw of selectors) {
    const token = normalizeString(raw);
    if (!token) continue;
    const separator = token.indexOf(':');
    if (separator > 0) {
      const mode = token.slice(0, separator).trim();
      const key = token.slice(separator + 1).trim();
      if (!KNOWN_MODES.has(mode) || !key) {
        throw new Error(`Invalid cohort selector "${token}". Use <key> or <mode>:<key>.`);
      }
      modeSelections.set(mode, key);
      continue;
    }
    globalSelections.add(token);
  }
  if (globalSelections.size > 1) {
    throw new Error('Multiple global cohort selectors are not supported in one request.');
  }
  const global = globalSelections.size ? Array.from(globalSelections)[0] : null;
  return { global, modeSelections };
};

const rankCohorts = (bucketMap) => (
  Array.from(bucketMap.entries())
    .map(([key, repos]) => ({
      key,
      repos: sortByRepoId(repos),
      count: repos.length,
      totalPriority: repos.reduce((sum, repo) => sum + (Number(repo?.priority) || 0), 0)
    }))
    .sort((a, b) => (
      b.count - a.count
      || b.totalPriority - a.totalPriority
      || keySort(a.key, b.key)
    ))
);

const buildBucketMap = (repos, mode) => {
  const buckets = new Map();
  const selectableRepos = repos.filter((repo) => isRepoSelectableForMode(repo, mode));
  const cohortCandidates = selectableRepos.length ? selectableRepos : repos;
  for (const repo of cohortCandidates) {
    const key = resolveEffectiveCohortKey(repo, mode);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(repo);
  }
  return buckets;
};

const toSelectionOutput = (selectedRepos, excludedRepos, selectedKey) => ({
  selectedKey,
  selectedRepos: sortByRepoId(selectedRepos),
  excluded: sortByRepoId(excludedRepos).map((repo) => ({
    repoId: repo.repoId,
    effectiveKey: resolveEffectiveCohortKey(repo, repo.__mode),
    reason: 'cohort-excluded'
  }))
});

export const selectFederationCohorts = ({
  repos = [],
  modes = [],
  policy = 'default',
  cohort = [],
  allowUnsafeMix = false
} = {}) => {
  const normalizedPolicy = normalizeString(policy) || 'default';
  const requestedModes = Array.from(new Set((Array.isArray(modes) ? modes : []).filter((mode) => KNOWN_MODES.has(mode))));
  const selectors = parseCohortSelectors(cohort);

  const warnings = [];
  const modeSelections = {};
  const selectedReposByMode = {};
  const excluded = {};

  for (const mode of requestedModes) {
    const explicitKey = selectors.modeSelections.get(mode) || selectors.global;
    const bucketMap = buildBucketMap(repos, mode);
    const ranked = rankCohorts(bucketMap);
    if (!ranked.length) {
      if (explicitKey) {
        const err = new Error(`Requested cohort "${explicitKey}" not found for mode "${mode}".`);
        err.code = FEDERATION_COHORT_ERRORS.COHORT_NOT_FOUND;
        throw err;
      }
      modeSelections[mode] = null;
      selectedReposByMode[mode] = [];
      excluded[mode] = [];
      continue;
    }

    if (explicitKey) {
      const match = ranked.find((entry) => entry.key === explicitKey);
      if (!match) {
        const err = new Error(`Requested cohort "${explicitKey}" not found for mode "${mode}".`);
        err.code = FEDERATION_COHORT_ERRORS.COHORT_NOT_FOUND;
        throw err;
      }
      const selectedRepos = match.repos.map((repo) => ({ ...repo, __mode: mode }));
      const excludedRepos = ranked
        .filter((entry) => entry.key !== explicitKey)
        .flatMap((entry) => entry.repos)
        .map((repo) => ({ ...repo, __mode: mode }));
      const output = toSelectionOutput(selectedRepos, excludedRepos, explicitKey);
      modeSelections[mode] = output.selectedKey;
      selectedReposByMode[mode] = output.selectedRepos.map(({ __mode, ...repo }) => repo);
      excluded[mode] = output.excluded;
      continue;
    }

    if (allowUnsafeMix) {
      warnings.push(FEDERATION_COHORT_WARNINGS.UNSAFE_MIXING);
      const selectedRepos = ranked
        .flatMap((entry) => entry.repos)
        .map((repo) => ({ ...repo, __mode: mode }));
      const output = toSelectionOutput(selectedRepos, [], null);
      modeSelections[mode] = output.selectedKey;
      selectedReposByMode[mode] = output.selectedRepos.map(({ __mode, ...repo }) => repo);
      excluded[mode] = output.excluded;
      continue;
    }

    if (normalizedPolicy === 'strict' && ranked.length > 1) {
      const err = new Error(`Multiple cohorts detected for mode "${mode}".`);
      err.code = FEDERATION_COHORT_ERRORS.MULTI_COHORT;
      throw err;
    }

    const selected = ranked[0];
    const excludedRepos = ranked
      .slice(1)
      .flatMap((entry) => entry.repos)
      .map((repo) => ({ ...repo, __mode: mode }));
    if (ranked.length > 1) warnings.push(FEDERATION_COHORT_WARNINGS.MULTI_COHORT);
    const output = toSelectionOutput(
      selected.repos.map((repo) => ({ ...repo, __mode: mode })),
      excludedRepos,
      selected.key
    );
    modeSelections[mode] = output.selectedKey;
    selectedReposByMode[mode] = output.selectedRepos.map(({ __mode, ...repo }) => repo);
    excluded[mode] = output.excluded;
  }

  return {
    policy: allowUnsafeMix ? 'unsafe-mix' : normalizedPolicy,
    modeSelections,
    selectedReposByMode,
    excluded,
    warnings: Array.from(new Set(warnings))
  };
};
