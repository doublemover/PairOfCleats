import picomatch from 'picomatch';
import { toRealPathSync } from '../../workspace/identity.js';

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }
  if (value == null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
};

const normalizeTags = (value) => (
  normalizeList(value).map((entry) => entry.toLowerCase())
);

const aliasSortKey = (repo) => {
  const alias = typeof repo?.alias === 'string' ? repo.alias.trim() : '';
  if (!alias) return '\uffff';
  return alias.toLowerCase();
};

const sortSelectedRepos = (repos) => (
  repos.slice().sort((a, b) => (
    (Number(b?.priority) || 0) - (Number(a?.priority) || 0)
    || aliasSortKey(a).localeCompare(aliasSortKey(b))
    || String(a?.repoId || '').localeCompare(String(b?.repoId || ''))
  ))
);

const createSelectMatcher = (token) => {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return () => false;
  const tokenLower = normalizedToken.toLowerCase();
  let canonicalToken = null;
  try {
    canonicalToken = toRealPathSync(normalizedToken);
  } catch {
    canonicalToken = null;
  }
  return (repo) => {
    const alias = typeof repo.alias === 'string' ? repo.alias : '';
    if (alias && alias.toLowerCase() === tokenLower) return true;
    if (String(repo.repoId || '').toLowerCase() === tokenLower) return true;
    if (canonicalToken && canonicalToken === repo.repoRootCanonical) return true;
    return false;
  };
};

const createFilterMatcher = (patterns) => {
  const matchers = normalizeList(patterns)
    .map((pattern) => picomatch(pattern, { nocase: true, dot: true }));
  return (repo) => {
    if (!matchers.length) return true;
    const alias = typeof repo.alias === 'string' ? repo.alias : '';
    const candidates = [repo.repoId, alias, repo.repoRootCanonical].map((value) => String(value || ''));
    return matchers.some((matcher) => candidates.some((candidate) => matcher(candidate)));
  };
};

export const selectWorkspaceRepos = ({
  workspaceConfig,
  select = [],
  tag = [],
  repoFilter = [],
  includeDisabled = false
} = {}) => {
  const allRepos = Array.isArray(workspaceConfig?.repos) ? workspaceConfig.repos : [];
  const baselineRepos = includeDisabled
    ? allRepos
    : allRepos.filter((repo) => repo.enabled !== false);

  const selectMatchers = normalizeList(select).map((entry) => createSelectMatcher(entry));
  const explicitRepos = selectMatchers.length
    ? allRepos.filter((repo) => selectMatchers.some((matcher) => matcher(repo)))
    : [];
  const candidateMap = new Map();
  for (const repo of baselineRepos) candidateMap.set(repo.repoId, repo);
  for (const repo of explicitRepos) candidateMap.set(repo.repoId, repo);
  let candidateRepos = Array.from(candidateMap.values());

  const tagFilters = normalizeTags(tag);
  if (tagFilters.length) {
    const required = new Set(tagFilters);
    candidateRepos = candidateRepos.filter((repo) => {
      const repoTags = Array.isArray(repo.tags) ? repo.tags : [];
      return repoTags.some((entry) => required.has(String(entry || '').toLowerCase()));
    });
  }

  const matchesRepoFilter = createFilterMatcher(repoFilter);
  candidateRepos = candidateRepos.filter((repo) => matchesRepoFilter(repo));
  const selectedRepos = sortSelectedRepos(candidateRepos);
  const selectedRepoIds = selectedRepos.map((repo) => repo.repoId).sort((a, b) => a.localeCompare(b));
  return {
    selectedRepos,
    selectedRepoIds,
    selectionMeta: {
      explicitSelects: normalizeList(select),
      tags: tagFilters.sort((a, b) => a.localeCompare(b)),
      repoFilter: normalizeList(repoFilter),
      includeDisabled: includeDisabled === true
    },
    warnings: selectedRepos.length ? [] : ['WARN_FEDERATED_EMPTY_SELECTION']
  };
};
