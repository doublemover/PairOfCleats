import fs from 'node:fs';
import path from 'node:path';

const BUILT_IN_REPO_PREFLIGHT_CONTRACTS = Object.freeze({
  koreader__koreader: Object.freeze({
    key: 'koreader__koreader',
    optionalSubmodules: [],
    requiredSubmodules: ['*'],
    notes: 'Submodule-heavy repo; fail with explicit contract classification when required content is missing.'
  }),
  hiddify__hiddify_app: Object.freeze({
    key: 'hiddify__hiddify_app',
    optionalSubmodules: [],
    requiredSubmodules: ['*'],
    notes: 'Auth/network-sensitive repo; keep failures precise and cacheable.'
  }),
  scala__scala3: Object.freeze({
    key: 'scala__scala3',
    optionalSubmodules: [],
    requiredSubmodules: ['*'],
    notes: 'Large required-submodule repo; do not collapse verification failures into generic preflight.'
  })
});

const sanitizeContractKey = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
);

const normalizePathList = (value) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim().replace(/\\/g, '/'))
    .filter(Boolean)
)).sort((left, right) => left.localeCompare(right));

const matchContractPath = (pattern, filePath) => {
  const normalizedPattern = String(pattern || '').trim().replace(/\\/g, '/');
  const normalizedPath = String(filePath || '').trim().replace(/\\/g, '/');
  if (!normalizedPattern || !normalizedPath) return false;
  if (normalizedPattern === '*') return true;
  if (normalizedPattern.endsWith('/*')) {
    return normalizedPath === normalizedPattern.slice(0, -2)
      || normalizedPath.startsWith(`${normalizedPattern.slice(0, -2)}/`);
  }
  return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
};

const resolveGitmodulesFingerprint = (repoPath) => {
  const gitmodulesPath = path.join(repoPath, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) return 'no-gitmodules';
  try {
    const stat = fs.statSync(gitmodulesPath);
    return `${Math.round(stat.mtimeMs)}:${stat.size}`;
  } catch {
    return 'gitmodules-stat-error';
  }
};

export const resolveRepoPreflightContract = ({ repoPath, repoContract = null } = {}) => {
  const repoName = sanitizeContractKey(path.basename(String(repoPath || '').trim()));
  const builtIn = repoName ? BUILT_IN_REPO_PREFLIGHT_CONTRACTS[repoName] || null : null;
  const sourceContract = repoContract && typeof repoContract === 'object'
    ? repoContract
    : builtIn;
  const key = sanitizeContractKey(sourceContract?.key || repoName || 'repo_preflight');
  const optionalSubmodules = normalizePathList(sourceContract?.optionalSubmodules);
  const requiredSubmodules = normalizePathList(sourceContract?.requiredSubmodules);
  const hasExplicitRequiredSubmodules = Array.isArray(sourceContract?.requiredSubmodules);
  return {
    schemaVersion: 1,
    key,
    repoName,
    optionalSubmodules,
    requiredSubmodules: hasExplicitRequiredSubmodules
      ? requiredSubmodules
      : (requiredSubmodules.length > 0 ? requiredSubmodules : ['*']),
    notes: String(sourceContract?.notes || '').trim() || null,
    fingerprint: `${key}|${resolveGitmodulesFingerprint(repoPath)}|optional=${optionalSubmodules.join(',')}|required=${requiredSubmodules.join(',')}`
  };
};

export const classifySubmoduleContractState = (entries, contract) => {
  const list = Array.isArray(entries) ? entries : [];
  const optionalPatterns = Array.isArray(contract?.optionalSubmodules) ? contract.optionalSubmodules : [];
  const requiredPatterns = Array.isArray(contract?.requiredSubmodules) ? contract.requiredSubmodules : ['*'];
  const optionalMissingPaths = [];
  const optionalDirtyPaths = [];
  const requiredMissingPaths = [];
  const requiredDirtyPaths = [];

  for (const entry of list) {
    const submodulePath = String(entry?.path || '').trim().replace(/\\/g, '/');
    if (!submodulePath) continue;
    const isOptional = optionalPatterns.some((pattern) => matchContractPath(pattern, submodulePath));
    const isRequired = requiredPatterns.some((pattern) => matchContractPath(pattern, submodulePath));
    if (entry?.missing) {
      if (isOptional && !isRequired) optionalMissingPaths.push(submodulePath);
      else requiredMissingPaths.push(submodulePath);
    }
    if (entry?.dirty) {
      if (isOptional && !isRequired) optionalDirtyPaths.push(submodulePath);
      else requiredDirtyPaths.push(submodulePath);
    }
  }

  return {
    optionalMissingPaths,
    optionalDirtyPaths,
    requiredMissingPaths,
    requiredDirtyPaths,
    hasRequiredFailures: requiredMissingPaths.length > 0 || requiredDirtyPaths.length > 0,
    hasOptionalFailures: optionalMissingPaths.length > 0 || optionalDirtyPaths.length > 0
  };
};

export const classifyRepoPreflightBlock = ({ detail = '', timedOut = false } = {}) => {
  const normalized = String(detail || '').trim();
  if (timedOut) {
    return {
      state: 'blocked_timeout',
      blockedClass: 'timeout'
    };
  }
  if (
    /host key verification failed|permission denied \(publickey\)|authentication failed|could not read from remote repository|could not read username|terminal prompts disabled|authentication required|could not resolve username/i.test(normalized)
  ) {
    return {
      state: 'blocked_auth',
      blockedClass: 'auth'
    };
  }
  if (
    /could not resolve host|connection timed out|failed to connect|network is unreachable|connection refused|tls/i.test(normalized)
  ) {
    return {
      state: 'blocked_network',
      blockedClass: 'network'
    };
  }
  return {
    state: 'blocked_repo_contract',
    blockedClass: 'repo_contract'
  };
};
