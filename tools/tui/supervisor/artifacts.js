import fs from 'node:fs';
import path from 'node:path';
import { resolveDispatchRequest } from '../../../src/shared/dispatch/resolve.js';
import {
  getIndexDir,
  getMetricsDir,
  getRepoCacheRoot,
  loadUserConfig
} from '../../shared/dict-utils.js';

/**
 * Stat one candidate artifact path and return normalized artifact metadata.
 *
 * @param {{kind:string,label:string,artifactPath:string}} input
 * @returns {Promise<object>}
 */
const statArtifact = async ({ kind, label, artifactPath }) => {
  try {
    const stat = await fs.promises.stat(artifactPath);
    return {
      kind,
      label,
      path: artifactPath,
      exists: true,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      mime: null
    };
  } catch {
    return {
      kind,
      label,
      path: artifactPath,
      exists: false,
      bytes: null,
      mtime: null,
      mime: null
    };
  }
};

/**
 * Parse `--repo` from tokenized argv/args vectors.
 *
 * @param {unknown[]} tokens
 * @returns {string|null}
 */
const resolveRepoArgFromTokens = (tokens) => {
  const list = Array.isArray(tokens) ? tokens.map((entry) => String(entry)) : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token === '--') break;
    if (token === '--repo') {
      const next = list[i + 1];
      if (typeof next === 'string' && next.trim()) return next.trim();
      continue;
    }
    if (token.startsWith('--repo=')) {
      const value = token.slice('--repo='.length).trim();
      if (value) return value;
    }
  }
  return null;
};

/**
 * Resolve the repo root used for artifact indexing for one run request.
 *
 * @param {{request:object,cwd?:string}} input
 * @returns {string}
 */
const resolveRequestRepoRoot = ({ request, cwd }) => {
  const baseCwd = request?.cwd
    ? path.resolve(String(request.cwd))
    : path.resolve(cwd || process.cwd());
  const argv = Array.isArray(request?.argv) ? request.argv : [];
  const args = Array.isArray(request?.args) ? request.args : [];
  const repoArg = resolveRepoArgFromTokens(argv) || resolveRepoArgFromTokens(args);
  if (repoArg) {
    return path.resolve(baseCwd, repoArg);
  }
  if (request?.repoRoot) {
    return path.resolve(String(request.repoRoot));
  }
  return baseCwd;
};

/**
 * Append index artifact roots for all supported modes.
 *
 * Stats are collected concurrently because these probes are independent.
 *
 * @param {{artifacts:object[],repoRoot:string,userConfig:object|null}} input
 * @returns {Promise<void>}
 */
const addIndexArtifacts = async ({ artifacts, repoRoot, userConfig }) => {
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  const rows = await Promise.all(modes.map((mode) => statArtifact({
    kind: `index:${mode}`,
    label: `${mode} index`,
    artifactPath: getIndexDir(repoRoot, mode, userConfig)
  })));
  artifacts.push(...rows);
};

/**
 * Append search metrics artifact paths.
 *
 * @param {{artifacts:object[],repoRoot:string,userConfig:object|null}} input
 * @returns {Promise<void>}
 */
const addSearchArtifacts = async ({ artifacts, repoRoot, userConfig }) => {
  const metricsDir = getMetricsDir(repoRoot, userConfig);
  const rows = await Promise.all([
    statArtifact({
      kind: 'metrics:search',
      label: 'search metrics dir',
      artifactPath: metricsDir
    }),
    statArtifact({
      kind: 'metrics:search-history',
      label: 'search history',
      artifactPath: path.join(metricsDir, 'searchHistory')
    })
  ]);
  artifacts.push(...rows);
};

/**
 * Append setup/config/cache artifact paths.
 *
 * @param {{artifacts:object[],repoRoot:string,userConfig:object|null}} input
 * @returns {Promise<void>}
 */
const addSetupArtifacts = async ({ artifacts, repoRoot, userConfig }) => {
  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const rows = await Promise.all([
    statArtifact({
      kind: 'config:file',
      label: 'config file',
      artifactPath: path.join(repoRoot, '.pairofcleats.json')
    }),
    statArtifact({
      kind: 'cache:repo-root',
      label: 'repo cache root',
      artifactPath: repoCacheRoot
    })
  ]);
  artifacts.push(...rows);
};

const ARTIFACT_COLLECTORS = Object.freeze({
  'index.build': addIndexArtifacts,
  'index.watch': addIndexArtifacts,
  search: addSearchArtifacts,
  setup: addSetupArtifacts,
  bootstrap: addSetupArtifacts
});

/**
 * Collect post-run artifact metadata for supported dispatch commands.
 *
 * @param {{request:object,cwd?:string}} input
 * @returns {Promise<object[]>}
 */
export const collectJobArtifacts = async ({ request, cwd }) => {
  const artifacts = [];
  const argv = Array.isArray(request?.argv) ? request.argv.map((entry) => String(entry)) : [];
  const dispatch = resolveDispatchRequest(argv);
  const repoRoot = resolveRequestRepoRoot({ request, cwd });
  let userConfig = null;
  try {
    userConfig = loadUserConfig(repoRoot);
  } catch {
    userConfig = null;
  }

  const collectArtifacts = ARTIFACT_COLLECTORS[dispatch?.id];
  if (typeof collectArtifacts === 'function') {
    await collectArtifacts({ artifacts, repoRoot, userConfig });
  }

  return artifacts
    .slice()
    .sort((a, b) => `${a.kind}|${a.path}`.localeCompare(`${b.kind}|${b.path}`));
};
