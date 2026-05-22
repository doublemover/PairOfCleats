import path from 'node:path';
import { status as coreStatus } from '../../../../src/integrations/core/index.js';
import { runNodeSync, runToolWithProgress } from '../../runner.js';
import { resolveMcpRepoContext, toolRoot } from '../helpers.js';

/**
 * Handle the MCP cache_gc tool call.
 * @param {object} [args]
 * @returns {object}
 */
export function cacheGc(args = {}) {
  const { repoPath, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'index', 'cache-gc.js'), '--json', '--repo', repoPath];
  if (args.dryRun === true) scriptArgs.push('--dry-run');
  if (Number.isFinite(Number(args.maxBytes))) scriptArgs.push('--max-bytes', String(args.maxBytes));
  if (Number.isFinite(Number(args.maxGb))) scriptArgs.push('--max-gb', String(args.maxGb));
  if (Number.isFinite(Number(args.maxAgeDays))) scriptArgs.push('--max-age-days', String(args.maxAgeDays));
  const stdout = runNodeSync(repoPath, scriptArgs, { env: runtimeEnv });
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return { repoPath, output: stdout.trim() };
  }
}

/**
 * Handle the MCP clean_artifacts tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function cleanArtifacts(args = {}, context = {}) {
  const { repoPath, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'index', 'clean-artifacts.js'), '--repo', repoPath];
  if (args.all === true) scriptArgs.push('--all');
  if (args.dryRun === true) scriptArgs.push('--dry-run');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Cleaning artifacts.',
    doneMessage: 'Artifact cleanup complete.',
    env: runtimeEnv
  });
  return { repoPath, output: stdout.trim() };
}

/**
 * Handle the MCP report_artifacts tool call.
 * @param {object} [args]
 * @returns {object}
 */
export async function reportArtifacts(args = {}) {
  const { repoPath } = resolveMcpRepoContext(args.repoPath, {
    includeRuntimeEnv: false,
    includeUserConfig: false
  });
  return coreStatus(repoPath);
}
