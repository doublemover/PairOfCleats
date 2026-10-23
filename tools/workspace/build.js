#!/usr/bin/env node
import path from 'node:path';
import { resolveWorkspaceBuildConcurrency, WORKSPACE_BUILD_OPTIONS } from '../../src/shared/index-tool-options.js';
import { fileURLToPath } from 'node:url';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';
import { resolveWorkspaceChildRuntimePlan } from '../../src/workspace/child-runtime-env.js';
import { createWorkspaceBuildRecovery } from './diagnostics.js';
import { createCli } from '../../src/shared/cli.js';
import { INDEX_BUILD_OPTIONS } from '../../src/shared/cli-option-sets.js';
import { validateBuildArgs } from '../../src/shared/cli-option-validators.js';
import { describeStorageFailure, observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

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
  const seenFiniteModes = new Set();

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
      const value = arg.slice(flagName.length + 3);
      if (!value) throw new Error(`Missing value for --${flagName}.`);
      return { value, skip: 0 };
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
      seenFiniteModes.add(name);
      i += parsed.skip;
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
  for (const name of seenFiniteModes) buildArgs.push(`--no-${name}`);
  const cli = createCli({ argv: ['node', 'workspace-build-child', ...buildArgs], options: INDEX_BUILD_OPTIONS })
    .help(false).version(false).exitProcess(false).strictOptions().fail(message => { throw new Error(message); });
  validateBuildArgs(cli.parseSync());

  return {
    workspacePath,
    concurrency,
    strict,
    includeDisabled,
    json,
    buildArgs
  };
};

/** Programmatic fanout callers have the same finite child-intent boundary. */
export const normalizeWorkspaceChildBuildArgs = (buildArgs = []) => {
  if (!Array.isArray(buildArgs) || buildArgs.some(value => typeof value !== 'string')) throw new Error('Workspace child build flags must be a string array.');
  for (const value of buildArgs) {
    if (/^--(?:no-)?(?:workspace|concurrency|strict|include-disabled|json|repo)(?:=|$)/.test(value)) {
      throw new Error('Workspace child build flags cannot override coordinator choices or repository membership.');
    }
  }
  return parseRawWorkspaceBuildArgs(['--workspace', '<resolved-workspace>', ...buildArgs]).buildArgs;
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

export const runRepoBuild = async ({ repo, buildArgs, signal: abortSignal = null, baseEnv = process.env }, {
  spawn = spawnSubprocess, resolveEnv = null, resolvePlan = resolveWorkspaceChildRuntimePlan
} = {}) => {
  const startedAt = Date.now();
  let startup = null;
  try {
    buildArgs = normalizeWorkspaceChildBuildArgs(buildArgs);
    abortSignal?.throwIfAborted();
    const request = { repoRoot: repo.repoRootCanonical, buildArgs, baseEnv: { ...baseEnv } };
    const plan = resolveEnv ? { env: await resolveEnv(request), evidence: null } : await resolvePlan(request);
    const env = plan.env;
    startup = plan.evidence;
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
    const observation = observeStorageResource(result, { phase: 'workspace-child-build-result' });
    observation.requireSettled();
    let entry;
    try {
      const rawStderr = result.stderr, rawExitCode = result.exitCode, rawSignal = result.signal;
      const stderr = typeof rawStderr === 'string' ? rawStderr.trim() : '';
      const exitCode = Number.isInteger(rawExitCode) ? rawExitCode : null;
      const signal = typeof rawSignal === 'string' && rawSignal.trim().length > 0
        ? rawSignal.trim()
        : null;
      entry = {
        repoId: repo.repoId,
        repoRootCanonical: repo.repoRootCanonical,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        startup,
        status: exitCode === 0 && !signal ? 'passed' : 'failed',
        error: (exitCode === 0 && !signal)
          ? null
          : (stderr || (signal ? `build_index exited via signal ${signal}` : `build_index exited with code ${exitCode}`))
      };
    } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    return entry;
  } catch (err) {
    // Unknown child teardown still belongs to the actual subprocess owner.
    // Do not turn it into a settled failure that permits another acquisition.
    const observation = observeStorageResource(err, { phase: 'workspace-child-build-error' });
    observation.requireSettled();
    let entry, resultObservation;
    try {
      const candidate = observation.primary.result;
      const result = candidate && typeof candidate === 'object' ? candidate : {};
      resultObservation = observeStorageResource(result, { phase: 'workspace-child-build-error-result' });
      resultObservation.requireSettled();
      const rawStderr = result.stderr, rawSignal = result.signal, rawExitCode = result.exitCode;
      const rawMessage = observation.primary.message;
      const stderr = typeof rawStderr === 'string' ? rawStderr.trim() : '';
      const signal = typeof rawSignal === 'string' && rawSignal.trim().length > 0
        ? rawSignal.trim()
        : null;
      const exitCode = Number.isInteger(rawExitCode) ? rawExitCode : null;
      const errorMessage = stderr
      || (typeof rawMessage === 'string' ? rawMessage.trim() : '')
      || (signal ? `build_index exited via signal ${signal}` : `build_index exited with code ${exitCode}`);
      entry = {
        repoId: repo.repoId,
        repoRootCanonical: repo.repoRootCanonical,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        startup,
        status: 'failed',
        error: errorMessage
      };
    } catch (inspection) {
      const retained = resultObservation ? resultObservation.retain(inspection, { inspectionPresent: true }) : inspection;
      throw observation.retain(retained, { inspectionPresent: true });
    }
    // Diagnostic getters can reveal new native work. Recheck both the actual
    // thrown owner and its original child result before publishing a projection.
    try { resultObservation.requireSettled(); }
    catch (pending) { throw observation.retain(pending, { inspectionPresent: true }); }
    observation.requireSettled();
    return entry;
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
  const invocationArgs = normalizeWorkspaceChildBuildArgs(buildArgs);
  // Retain this invocation's target inventory before any build callback awaits.
  const configured = workspaceConfig.repos.map(repo => ({ ...repo }));
  const targets = configured
    .filter((repo) => includeDisabled || repo.enabled !== false)
    .slice()
    .sort((a, b) => a.repoId.localeCompare(b.repoId));
  const identities = targets.map(({ repoId, repoRootCanonical }) => ({ repoId, repoRootCanonical }));
  const excluded = configured.filter(repo => !includeDisabled && repo.enabled === false)
    .map(({ repoId, repoRootCanonical }) => ({ repoId, repoRootCanonical, reason: 'disabled' }))
    .sort((a, b) => a.repoId.localeCompare(b.repoId));
  const results = new Array(targets.length);
  let cursor = 0;
  let stopScheduling = false;
  const pendingOwners = [];
  const worker = async () => {
    while (true) {
      if (signal?.aborted || pendingOwners.length || (strict && stopScheduling)) return;
      const next = cursor;
      if (next >= targets.length) return;
      cursor += 1;
      const repo = targets[next];
      let result;
      try {
        const candidate = await runBuild({ repo, buildArgs: [...invocationArgs], signal, baseEnv: { ...invocationEnv } });
        const observation = observeStorageResource(candidate, { phase: 'workspace-build-outcome' });
        observation.requireSettled();
        try {
          result = candidate && typeof candidate === 'object' ? { ...candidate } : null;
          observation.requireSettled();
        } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
        if (result?.status === 'passed' && (result.exitCode !== 0 || result.signal)) {
          result = { ...result, status: 'failed', error: 'Repository build reported success without a zero, unsignalled child exit.' };
        }
      }
      catch (error) {
        let failure;
        try { failure = describeStorageFailure(error, { phase: 'workspace-build-outcome' }); }
        catch (pending) { pendingOwners.push(pending); }
        result = { repoId: repo.repoId, repoRootCanonical: repo.repoRootCanonical, exitCode: null,
          signal: null, durationMs: 0, status: failure ? 'failed' : 'settlement-pending',
          error: failure?.message || 'Repository child ownership remains unresolved.' };
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
    .map(repo => ({ ...repo, status: 'skipped', reason: pendingOwners.length ? 'settlement-pending' : signal?.aborted ? 'cancelled' : 'strict-failure' }));
  const failed = entries.filter(entry => entry.status !== 'passed').length;
  const report = {
    total: entries.length, failed, entries,
    configured: configured.length, selected: targets.length, attempted: entries.length,
    passed: entries.length - failed, skippedAfterFailure: skipped.filter(entry => entry.reason === 'strict-failure').length,
    skippedCancelled: skipped.filter(entry => entry.reason === 'cancelled').length,
    skippedSettlementPending: skipped.filter(entry => entry.reason === 'settlement-pending').length,
    excludedDisabled: excluded.length, skipped, excluded,
    outcome: targets.length === 0 ? 'no-work' : pendingOwners.length ? 'settlement-pending' : signal?.aborted ? 'cancelled' : failed ? 'failed' : 'passed'
  };
  if (pendingOwners.length) {
    let pending = pendingOwners[0];
    for (const owner of pendingOwners.slice(1)) pending = addStorageFailureContext(pending, {}, owner, { secondaryPresent: true });
    throw addStorageFailureContext(pending, { workspaceBuildDiagnostics: report, workspaceBuildPendingOwners: pendingOwners });
  }
  return report;
};

/** Compatibility owner: existing callers receive attempted build entries only. */
export const runWorkspaceBuild = async (...args) => (await runWorkspaceBuildReport(...args)).entries;

export async function runWorkspaceBuildCli(rawArgs = process.argv.slice(2), {
  runBuild = runRepoBuild, refreshManifest = generateWorkspaceManifest
} = {}) {
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
  try { diagnostics = await runWorkspaceBuildReport(workspaceConfig, { ...options, signal: cancellation.signal }, { runBuild }); }
  catch (error) {
    if (!error?.cacheOwnershipPending) throw error;
    const payload = { ok: false, state: 'settlement-pending', workspacePath: workspaceConfig.workspacePath,
      manifestRefresh: 'not-performed-settlement-pending', diagnostics: error.workspaceBuildDiagnostics,
      pendingOwnershipCount: error.workspaceBuildPendingOwners?.length || 1,
      nextAction: 'The actual subprocess owner still has unresolved teardown. Do not replay this build until it settles.' };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else console.error(JSON.stringify(payload, null, 2));
    process.exitCode = cancellationExitCode || 1;
    return payload;
  }
  finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
  const buildDiagnostics = diagnostics.entries;
  const failed = buildDiagnostics.filter((entry) => entry.status !== 'passed');
  let manifestResult = null, manifestError = null;
  if (diagnostics.outcome !== 'cancelled') {
    try { manifestResult = await refreshManifest(workspaceConfig, { write: true }); }
    catch (error) {
      try { manifestError = describeStorageFailure(error, { phase: 'workspace-build-manifest-refresh' }); }
      catch (pending) { throw addStorageFailureContext(pending, { workspaceBuildDiagnostics: diagnostics }); }
    }
  }

  const payload = {
    ok: failed.length === 0 && diagnostics.outcome !== 'cancelled' && !manifestError,
    workspacePath: workspaceConfig.workspacePath,
    manifestPath: manifestResult?.manifestPath || null,
    repoSetId: workspaceConfig.repoSetId,
    manifestHash: manifestResult?.manifest.manifestHash || null,
    manifestRefresh: manifestError ? 'failed' : manifestResult ? 'completed' : 'not-performed-cancelled',
    ...(manifestError ? { manifestError } : {}),
    diagnostics,
    recovery: createWorkspaceBuildRecovery(workspaceConfig, diagnostics, options.buildArgs),
    qualification: 'Build outcomes describe this invocation. The manifest can retain earlier generations for modes or members not rebuilt.'
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(`Workspace build ${diagnostics.outcome}`);
    console.error(`- workspace: ${payload.workspacePath}`);
    console.error(`- repos attempted: ${payload.diagnostics.total}`);
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
    if (manifestError) console.error(`- manifest refresh failed: ${manifestError.code}: ${manifestError.message}`);
    for (const retry of payload.recovery.retryCandidates) console.error(`  retry (${retry.repoId}): ${retry.command.map(value => JSON.stringify(value)).join(' ')}`);
    console.error(payload.qualification);
  }

  if (cancellationExitCode) { process.exitCode = cancellationExitCode; return payload; }
  if (failed.length > 0) {
    const firstSignal = failed.find((entry) => typeof entry?.signal === 'string' && entry.signal.trim().length > 0)?.signal || null;
    if (firstSignal) {
      exitLikeCommandResult({ status: null, signal: firstSignal });
    }
    process.exitCode = 1;
  }
  if (manifestError) process.exitCode = 1;
  return payload;
}

if (isDirectExecution(import.meta.url)) {
  runWorkspaceBuildCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
