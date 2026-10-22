import path from 'node:path';
import { runNodeAsync, runToolWithProgress } from '../../runner.js';
import { resolveMcpRepoContext, toolRoot } from '../helpers.js';

/**
 * Handle the MCP cache_gc tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function cacheGc(args = {}, context = {}) {
  const limits = [['maxBytes', '--max-bytes'], ['maxGb', '--max-gb'], ['maxAgeDays', '--max-age-days']];
  const selected = limits.filter(([name]) => args[name] != null);
  if (!selected.length || selected.some(([name]) => typeof args[name] !== 'number'
    || !Number.isFinite(args[name]) || args[name] <= 0)) {
    throw Object.assign(new Error('cache_gc requires at least one positive finite size or age limit.'), { code: 'INVALID_REQUEST' });
  }
  const { repoPath, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'mcp', 'cache-gc-worker.js'), '--json', '--repo', repoPath];
  if (args.dryRun === true) scriptArgs.push('--dry-run');
  if (args.dryRun === false) scriptArgs.push('--apply');
  for (const [name, flag] of selected) scriptArgs.push(flag, String(args[name]));
  const { stdout } = await runNodeAsync(repoPath, scriptArgs, { env: runtimeEnv, signal: context.signal });
  let payload;
  try { payload = JSON.parse(stdout); }
  catch (cause) { throw Object.assign(new Error('cache_gc worker returned invalid JSON.', { cause }), { code: 'INTERNAL' }); }
  if (payload?.ok === false) throw Object.assign(new Error(payload.message || payload.error?.message || 'Cache collection failed.'),
    { code: payload.code || payload.error?.code || 'INTERNAL', details: payload });
  return payload;
}

/**
 * Handle the MCP clean_artifacts tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function cleanArtifacts(args = {}, context = {}) {
  if (args.all === true) throw new Error('Repository-scoped MCP cleanup cannot remove all repository caches. Use the user-owned maintenance CLI.');
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
  const { status: coreStatus } = await import('../../../../src/integrations/core/status.js');
  const { repoPath } = resolveMcpRepoContext(args.repoPath, {
    includeRuntimeEnv: false,
    includeUserConfig: false
  });
  return coreStatus(repoPath);
}
