import fs from 'node:fs';
import path from 'node:path';
import {
  getRuntimeConfig,
  loadUserConfig,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../../shared/dict-utils.js';
import { createProgressReporter } from '../../../src/shared/progress-events.js';
import { resolveRepoPath } from '../repo.js';
import { runNodeSync } from '../runner.js';

export const toolRoot = resolveToolRoot();

export const resolveRepoRuntimeEnv = (repoPath, userConfig, baseEnv = process.env) => {
  const runtimeConfig = getRuntimeConfig(repoPath, userConfig, baseEnv);
  return resolveRuntimeEnv(runtimeConfig, baseEnv);
};

export const resolveMcpRepoContext = (repoArg, options = {}) => {
  const {
    baseEnv = process.env,
    includeRuntimeEnv = true,
    includeUserConfig = true
  } = options;
  const repoPath = resolveRepoPath(repoArg);
  const shouldLoadConfig = includeUserConfig || includeRuntimeEnv;
  const userConfig = shouldLoadConfig ? loadUserConfig(repoPath) : null;
  if (!includeRuntimeEnv) {
    return { repoPath, userConfig };
  }
  const runtimeConfig = getRuntimeConfig(repoPath, userConfig, baseEnv);
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, baseEnv);
  return { repoPath, userConfig, runtimeConfig, runtimeEnv };
};

/**
 * Restore CI artifacts if present.
 * @param {string} repoPath
 * @param {string} artifactsDir
 * @param {object} progress
 * @param {Record<string,string|undefined>} runtimeEnv
 * @returns {boolean}
 */
export function maybeRestoreArtifacts(repoPath, artifactsDir, progress, runtimeEnv) {
  const fromDir = artifactsDir ? path.resolve(artifactsDir) : path.join(repoPath, 'ci-artifacts');
  if (!fs.existsSync(path.join(fromDir, 'manifest.json'))) return false;
  const reporter = createProgressReporter(progress);
  reporter?.start(`Restoring CI artifacts from ${fromDir}`);
  runNodeSync(
    repoPath,
    [path.join(toolRoot, 'tools', 'ci', 'restore-artifacts.js'), '--repo', repoPath, '--from', fromDir],
    { env: runtimeEnv }
  );
  reporter?.done('CI artifacts restored.');
  return true;
}
