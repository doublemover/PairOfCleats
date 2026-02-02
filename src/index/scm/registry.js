import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertScmProvider, normalizeProviderName } from './provider.js';
import { SCM_PROVIDER_NAMES } from './types.js';
import { gitProvider } from './providers/git.js';
import { jjProvider } from './providers/jj.js';
import { noneProvider } from './providers/none.js';

const PROVIDER_REGISTRY = Object.freeze({
  git: assertScmProvider(gitProvider),
  jj: assertScmProvider(jjProvider),
  none: assertScmProvider(noneProvider)
});

const SCM_MARKERS = {
  git: '.git',
  jj: '.jj'
};

const canRun = (cmd, args = ['--version']) => {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
};

const findMarkerRoot = (startPath, marker) => {
  let current = path.resolve(startPath);
  while (true) {
    const markerPath = path.join(current, marker);
    if (fs.existsSync(markerPath)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};

export const resolveScmConfig = ({ indexingConfig = {}, analysisPolicy = null } = {}) => {
  const scmConfig = indexingConfig.scm || {};
  const annotateConfig = scmConfig.annotate || {};
  let annotateEnabled = typeof annotateConfig.enabled === 'boolean' ? annotateConfig.enabled : null;
  if (annotateEnabled == null) {
    const policyBlame = analysisPolicy && typeof analysisPolicy === 'object'
      ? analysisPolicy?.git?.blame
      : null;
    if (typeof policyBlame === 'boolean') {
      annotateEnabled = policyBlame;
    } else if (typeof indexingConfig.gitBlame === 'boolean') {
      annotateEnabled = indexingConfig.gitBlame;
    } else {
      annotateEnabled = true;
    }
  }
  return {
    ...scmConfig,
    annotate: {
      ...annotateConfig,
      enabled: annotateEnabled
    }
  };
};

export const resolveScmProvider = ({ provider, startPath, log } = {}) => {
  const normalized = provider ? normalizeProviderName(provider) : null;
  const requested = normalized || 'auto';
  const repoRoot = path.resolve(startPath || process.cwd());
  const warn = typeof log === 'function' ? log : null;
  const gitRoot = findMarkerRoot(repoRoot, SCM_MARKERS.git);
  const jjRoot = findMarkerRoot(repoRoot, SCM_MARKERS.jj);

  if (requested === 'none') {
    return { provider: 'none', repoRoot, detectedBy: 'none' };
  }

  if (requested === 'git') {
    if (!gitRoot) throw new Error('SCM provider git requested but no .git directory was found.');
    if (!canRun('git')) throw new Error('SCM provider git requested but git is unavailable.');
    return { provider: 'git', repoRoot: gitRoot, detectedBy: 'git-root' };
  }

  if (requested === 'jj') {
    if (!jjRoot) throw new Error('SCM provider jj requested but no .jj directory was found.');
    if (!canRun('jj')) throw new Error('SCM provider jj requested but jj is unavailable.');
    return { provider: 'jj', repoRoot: jjRoot, detectedBy: 'jj-root' };
  }

  if (gitRoot && jjRoot) {
    throw new Error('Both .git and .jj were found; set --scm-provider explicitly.');
  }

  if (gitRoot) {
    if (canRun('git')) {
      return { provider: 'git', repoRoot: gitRoot, detectedBy: 'git-root' };
    }
    if (warn) warn('[scm] Git repo detected but git is unavailable; falling back to provider=none.');
  }

  if (jjRoot) {
    if (canRun('jj')) {
      return { provider: 'jj', repoRoot: jjRoot, detectedBy: 'jj-root' };
    }
    if (warn) warn('[scm] JJ repo detected but jj is unavailable; falling back to provider=none.');
  }

  return { provider: 'none', repoRoot, detectedBy: 'none' };
};

export const getScmProvider = (name) => {
  const normalized = normalizeProviderName(name);
  if (!normalized || !SCM_PROVIDER_NAMES.includes(normalized)) {
    return PROVIDER_REGISTRY.none;
  }
  return PROVIDER_REGISTRY[normalized] || PROVIDER_REGISTRY.none;
};

export const getScmProviderAndRoot = ({ provider, startPath, log } = {}) => {
  const selection = resolveScmProvider({ provider, startPath, log });
  const providerImpl = getScmProvider(selection.provider);
  return { ...selection, providerImpl };
};
