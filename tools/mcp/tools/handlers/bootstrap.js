import path from 'node:path';
import { loadUserConfig } from '../../../dict-utils.js';
import { resolveRepoPath } from '../../repo.js';
import { runToolWithProgress } from '../../runner.js';
import { resolveRepoRuntimeEnv, toolRoot } from '../helpers.js';

/**
 * Handle the MCP bootstrap tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function runBootstrap(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
  const scriptArgs = [path.join(toolRoot, 'tools', 'bootstrap.js'), '--repo', repoPath];
  if (args.skipInstall === true) scriptArgs.push('--skip-install');
  if (args.skipDicts === true) scriptArgs.push('--skip-dicts');
  if (args.skipIndex === true) scriptArgs.push('--skip-index');
  if (args.skipArtifacts === true) scriptArgs.push('--skip-artifacts');
  if (args.skipTooling === true) scriptArgs.push('--skip-tooling');
  if (args.withSqlite === true) scriptArgs.push('--with-sqlite');
  if (args.incremental === true) scriptArgs.push('--incremental');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Bootstrapping repo.',
    doneMessage: 'Bootstrap complete.',
    env: runtimeEnv
  });
  return { repoPath, output: stdout.trim() };
}
