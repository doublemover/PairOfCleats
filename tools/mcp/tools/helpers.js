import fs from 'node:fs';
import path from 'node:path';
import {
  getRuntimeConfig,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../../shared/dict-utils.js';
import { runNodeSync } from '../runner.js';

export const toolRoot = resolveToolRoot();

export const resolveRepoRuntimeEnv = (repoPath, userConfig) => {
  const runtimeConfig = getRuntimeConfig(repoPath, userConfig);
  return resolveRuntimeEnv(runtimeConfig, process.env);
};

/**
 * Restore CI artifacts if present.
 * @param {string} repoPath
 * @param {string} artifactsDir
 * @returns {boolean}
 */
export function maybeRestoreArtifacts(repoPath, artifactsDir, progress, runtimeEnv) {
  const fromDir = artifactsDir ? path.resolve(artifactsDir) : path.join(repoPath, 'ci-artifacts');
  if (!fs.existsSync(path.join(fromDir, 'manifest.json'))) return false;
  if (progress) {
    progress({
      message: `Restoring CI artifacts from ${fromDir}`,
      phase: 'start'
    });
  }
  runNodeSync(
    repoPath,
    [path.join(toolRoot, 'tools', 'ci', 'restore-artifacts.js'), '--repo', repoPath, '--from', fromDir],
    { env: runtimeEnv }
  );
  if (progress) {
    progress({
      message: 'CI artifacts restored.',
      phase: 'done'
    });
  }
  return true;
}
