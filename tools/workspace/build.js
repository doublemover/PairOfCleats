#!/usr/bin/env node
import path from 'node:path';
import { resolveWorkspaceBuildConcurrency, WORKSPACE_BUILD_OPTIONS } from '../../src/shared/index-tool-options.js';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';
import { resolveWorkspaceChildRuntimeEnv } from '../../src/workspace/child-runtime-env.js';

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD_INDEX_SCRIPT = path.join(TOOL_ROOT, 'build_index.js');

export const parseRawWorkspaceBuildArgs = (rawArgs) => {
  const buildArgs = [];
  let workspacePath = '';
  let concurrency = WORKSPACE_BUILD_OPTIONS.concurrency.default;
  let strict = WORKSPACE_BUILD_OPTIONS.strict.default;
  let includeDisabled = WORKSPACE_BUILD_OPTIONS['include-disabled'].default;
  let json = WORKSPACE_BUILD_OPTIONS.json.default;
  const finiteModes = { watch: false, 'config-dump': false };

  const readBoolean = (arg, index, name) => {
    if (arg.startsWith(`--no-${name}=`)) throw new Error(`Use --no-${name} without a value.`);
    const negated = arg === `--no-${name}`;
    if (negated) return { value: false, skip: 0 };
    if (arg !== `--${name}` && !arg.startsWith(`--${name}=`)) return null;
    const equals = arg.startsWith(`--${name}=`);
    const text = equals ? arg.slice(name.length + 3) : rawArgs[index + 1];
    if (!equals && text !== 'true' && text !== 'false') {
      if (typeof text === 'string' && !text.startsWith('-')) throw new Error(`--${name} requires true or false.`);
      return { value: true, skip: 0 };
    }
    if (text !== 'true' && text !== 'false') throw new Error(`--${name} requires true or false.`);
    return { value: text === 'true', skip: equals ? 0 : 1 };
  };

  const readValue = (arg, index, flagName) => {
    if (arg === `--${flagName}`) {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for --${flagName}.`);
      }
      return { value, skip: 1 };
    }
    if (arg.startsWith(`--${flagName}=`)) {
      return { value: arg.slice(flagName.length + 3), skip: 0 };
    }
    return null;
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--') {
      if (i + 1 < rawArgs.length) throw new Error('workspace build accepts build flags only; positional arguments after -- are unsupported.');
      break;
    }
    const workspaceValue = readValue(arg, i, 'workspace');
    if (workspaceValue) {
      workspacePath = workspaceValue.value;
      i += workspaceValue.skip;
      continue;
    }
    const concurrencyValue = readValue(arg, i, 'concurrency');
    if (concurrencyValue) {
      concurrency = resolveWorkspaceBuildConcurrency(concurrencyValue.value);
      i += concurrencyValue.skip;
      continue;
    }
    let consumed = false;
    for (const name of ['strict', 'include-disabled', 'json']) {
      const parsed = readBoolean(arg, i, name);
      if (!parsed) continue;
      if (name === 'strict') strict = parsed.value;
      else if (name === 'include-disabled') includeDisabled = parsed.value;
      else json = parsed.value;
      i += parsed.skip;
      consumed = true;
      break;
    }
    if (consumed) continue;
    for (const name of Object.keys(finiteModes)) {
      const parsed = readBoolean(arg, i, name);
      if (!parsed) continue;
      finiteModes[name] = parsed.value;
      buildArgs.push(arg);
      if (parsed.skip) buildArgs.push(rawArgs[++i]);
      consumed = true;
      break;
    }
    if (consumed) {
      continue;
    }
    buildArgs.push(arg);
  }

  if (!workspacePath) {
    throw new Error('workspace build requires --workspace <path>.');
  }
  if (finiteModes.watch) throw new Error('workspace build is finite and does not support --watch; use index build --watch --repo <path> for an individual repository.');
  if (finiteModes['config-dump']) throw new Error('workspace build does not support --config-dump; use config dump --repo <path> for each repository preview.');
  if (buildArgs.some((entry) => entry === '--repo' || entry.startsWith('--repo='))) {
    throw new Error('workspace build does not allow --repo; repo roots come from the workspace file.');
  }

  return {
    workspacePath,
    concurrency,
    strict,
    includeDisabled,
    json,
    buildArgs
  };
};

const printWorkspaceBuildHelp = () => {
  console.error('Usage: pairofcleats workspace build --workspace <path> [options] [build flags]');
  console.error('');
  console.error('Options:');
  console.error('  --workspace <path>        Workspace config path (.jsonc)');
  console.error('  --concurrency <n>         Max concurrent repo builds (default: 2)');
  console.error('  --strict                  Stop scheduling new repos after first failure');
  console.error('  --include-disabled        Include disabled repos from the workspace');
  console.error('  --json                    Emit JSON summary');
  console.error('  -h, --help                Show this help');
};

export const runRepoBuild = async ({ repo, buildArgs, signal: abortSignal = null, baseEnv = process.env }, { spawn = spawnSubprocess, resolveEnv = resolveWorkspaceChildRuntimeEnv } = {}) => {
  const startedAt = Date.now();
  try {
    abortSignal?.throwIfAborted();
    const env = await resolveEnv({ repoRoot: repo.repoRootCanonical, buildArgs, baseEnv: { ...baseEnv } });
    abortSignal?.throwIfAborted();
    const result = await spawn(
      process.execPath,
      [BUILD_INDEX_SCRIPT, ...buildArgs, '--repo', repo.repoRootCanonical],
      {
        cwd: repo.repoRootCanonical,
        env,
        signal: abortSignal,
        stdio: ['ignore', 'ignore', 'pipe'],
        captureStdout: false,
        captureStderr: true,
        maxOutputBytes: 64 * 1024,
        rejectOnNonZeroExit: false
      }
    );
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
    const signal = typeof result.signal === 'string' && result.signal.trim().length > 0
      ? result.signal.trim()
      : null;
    return {
      repoId: repo.repoId,
      repoRootCanonical: repo.repoRootCanonical,
      exitCode,
      signal,
      durationMs: Date.now() - startedAt,
      status: exitCode === 0 && !signal ? 'passed' : 'failed',
      error: (exitCode === 0 && !signal)
        ? null
        : (stderr || (signal ? `build_index exited via signal ${signal}` : `build_index exited with code ${result.exitCode}`))
    };
  } catch (err) {
    // Unknown child teardown still belongs to the actual subprocess owner.
    // Do not turn it into a settled failure that permits another acquisition.
    if (err?.cacheOwnershipPending) throw err;
    const result = err?.result && typeof err.result === 'object' ? err.result : {};
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const signal = typeof result.signal === 'string' && result.signal.trim().length > 0
      ? result.signal.trim()
      : null;
    const exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
    const errorMessage = stderr
      || (typeof err?.message === 'string' && err.message.trim().length > 0 ? err.message.trim() : '')
      || (signal ? `build_index exited via signal ${signal}` : `build_index exited with code ${exitCode}`);
    return {
      repoId: repo.repoId,
      repoRootCanonical: repo.repoRootCanonical,
      exitCode,
      signal,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      error: errorMessage
    };
  }
};

export const runWorkspaceBuildReport = async (workspaceConfig, {
  buildArgs = [],
  includeDisabled = false,
  concurrency = WORKSPACE_BUILD_OPTIONS.concurrency.default,
  strict = false,
  signal = null,
  baseEnv = process.env
} = {}, { runBuild = runRepoBuild } = {}) => {
  concurrency = resolveWorkspaceBuildConcurrency(concurrency);
  const invocationEnv = { ...baseEnv };
  const invocationArgs = [...buildArgs];
  // Retain this invocation's target inventory before any build callback awaits.
  const configured = workspaceConfig.repos.map(repo => ({ ...repo }));
  const targets = configured
    .filter((repo) => includeDisabled || repo.enabled)
    .slice()
    .sort((a, b) => a.repoId.localeCompare(b.repoId));
  const identities = targets.map(({ repoId, repoRootCanonical }) => ({ repoId, repoRootCanonical }));
  const excluded = configured.filter(repo => !includeDisabled && !repo.enabled)
    .map(({ repoId, repoRootCanonical }) => ({ repoId, repoRootCanonical, reason: 'disabled' }))
    .sort((a, b) => a.repoId.localeCompare(b.repoId));
  const results = new Array(targets.length);
  let cursor = 0;
  let stopScheduling = false;
  let pendingOwnerError = null;
  const worker = async () => {
    while (true) {
      if (signal?.aborted || pendingOwnerError || (strict && stopScheduling)) return;
      const next = cursor;
      if (next >= targets.length) return;
      cursor += 1;
      const repo = targets[next];
      let result;
      try { result = await runBuild({ repo, buildArgs: [...invocationArgs], signal, baseEnv: { ...invocationEnv } }); }
      catch (error) {
        if (error?.cacheOwnershipPending && !pendingOwnerError) pendingOwnerError = error;
        result = { repoId: repo.repoId, repoRootCanonical: repo.repoRootCanonical, exitCode: null,
          signal: null, durationMs: 0, status: error?.cacheOwnershipPending ? 'settlement-pending' : 'failed', error: error?.message || String(error) };
      }
      if (!result || typeof result !== 'object') {
        result = { exitCode: null, signal: null, durationMs: 0, status: 'failed', error: 'Repository build returned no outcome.' };
      }
      results[next] = { ...result, ...identities[next] };
      if (strict && result.status !== 'passed') {
        stopScheduling = true;
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  const entries = results.filter(Boolean);
  const skipped = identities.filter((_repo, index) => !results[index])
    .map(repo => ({ ...repo, status: 'skipped', reason: pendingOwnerError ? 'settlement-pending' : signal?.aborted ? 'cancelled' : 'strict-failure' }));
  const failed = entries.filter(entry => entry.status !== 'passed').length;
  const report = {
    total: entries.length, failed, entries,
    configured: configured.length, selected: targets.length, attempted: entries.length,
    passed: entries.length - failed, skippedAfterFailure: skipped.filter(entry => entry.reason === 'strict-failure').length,
    skippedCancelled: skipped.filter(entry => entry.reason === 'cancelled').length,
    skippedSettlementPending: skipped.filter(entry => entry.reason === 'settlement-pending').length,
    excludedDisabled: excluded.length, skipped, excluded,
    outcome: targets.length === 0 ? 'no-work' : pendingOwnerError ? 'settlement-pending' : signal?.aborted ? 'cancelled' : failed ? 'failed' : 'passed'
  };
  if (pendingOwnerError) {
    pendingOwnerError.workspaceBuildDiagnostics = report;
    throw pendingOwnerError;
  }
  return report;
};

/** Compatibility owner: existing callers receive attempted build entries only. */
export const runWorkspaceBuild = async (...args) => (await runWorkspaceBuildReport(...args)).entries;

export async function runWorkspaceBuildCli(rawArgs = process.argv.slice(2)) {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printWorkspaceBuildHelp();
    return;
  }
  const options = parseRawWorkspaceBuildArgs(rawArgs);
  const workspaceConfig = loadWorkspaceConfig(options.workspacePath);
  const cancellation = new AbortController();
  let cancellationExitCode = null;
  const onInterrupt = () => { cancellationExitCode = 130; cancellation.abort(new Error('Workspace build interrupted.')); };
  const onTerminate = () => { cancellationExitCode = 143; cancellation.abort(new Error('Workspace build terminated.')); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  let diagnostics;
  try { diagnostics = await runWorkspaceBuildReport(workspaceConfig, { ...options, signal: cancellation.signal }); }
  catch (error) {
    if (!error?.cacheOwnershipPending) throw error;
    const payload = { ok: false, state: 'settlement-pending', workspacePath: workspaceConfig.workspacePath,
      manifestRefresh: 'not-performed-settlement-pending', diagnostics: error.workspaceBuildDiagnostics,
      nextAction: 'The actual subprocess owner still has unresolved teardown. Do not replay this build until it settles.' };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(JSON.stringify(payload, null, 2));
    process.exitCode = cancellationExitCode || 1;
    return;
  }
  finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
  const buildDiagnostics = diagnostics.entries;
  const failed = buildDiagnostics.filter((entry) => entry.status !== 'passed');
  const manifestResult = diagnostics.outcome === 'cancelled' ? null : await generateWorkspaceManifest(workspaceConfig, { write: true });

  const payload = {
    ok: failed.length === 0 && diagnostics.outcome !== 'cancelled',
    workspacePath: workspaceConfig.workspacePath,
    manifestPath: manifestResult?.manifestPath || null,
    repoSetId: workspaceConfig.repoSetId,
    manifestHash: manifestResult?.manifest.manifestHash || null,
    manifestRefresh: manifestResult ? 'completed' : 'not-performed-cancelled',
    diagnostics
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(`Workspace build ${diagnostics.outcome}`);
    console.error(`- workspace: ${payload.workspacePath}`);
    console.error(`- repos built: ${payload.diagnostics.total}`);
    console.error(`- repos selected: ${diagnostics.selected}; skipped after failure: ${diagnostics.skippedAfterFailure}; disabled: ${diagnostics.excludedDisabled}`);
    console.error(`- build outcome: ${diagnostics.outcome}`);
    console.error(`- repos failed: ${payload.diagnostics.failed}`);
    console.error(`- manifest: ${payload.manifestPath}`);
    console.error(`- repoSetId: ${payload.repoSetId}`);
    console.error(`- manifestHash: ${payload.manifestHash}`);
    for (const entry of buildDiagnostics) {
      if (entry.status === 'passed') {
        console.error(`  - ${entry.repoId}: passed (${entry.durationMs}ms)`);
      } else {
        console.error(`  - ${entry.repoId}: failed (${entry.durationMs}ms)`);
        if (entry.error) console.error(`    ${entry.error}`);
      }
    }
    for (const entry of diagnostics.skipped) console.error(`  - ${entry.repoId}: skipped (${entry.reason})`);
  }

  if (cancellationExitCode) { process.exitCode = cancellationExitCode; return; }
  if (failed.length > 0) {
    const firstSignal = failed.find((entry) => typeof entry?.signal === 'string' && entry.signal.trim().length > 0)?.signal || null;
    if (firstSignal) {
      exitLikeCommandResult({ status: null, signal: firstSignal });
    }
    process.exit(1);
  }
}

if (isDirectExecution(import.meta.url)) {
  runWorkspaceBuildCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
