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
    if (arg === '--') { buildArgs.push(...rawArgs.slice(i)); break; }
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

export const runRepoBuild = async ({ repo, buildArgs }, { spawn = spawnSubprocess, resolveEnv = resolveWorkspaceChildRuntimeEnv } = {}) => {
  const startedAt = Date.now();
  try {
    const env = await resolveEnv({ repoRoot: repo.repoRootCanonical, buildArgs, baseEnv: process.env });
    const result = await spawn(
      process.execPath,
      [BUILD_INDEX_SCRIPT, ...buildArgs, '--repo', repo.repoRootCanonical],
      {
        cwd: repo.repoRootCanonical,
        env,
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
  buildArgs,
  includeDisabled,
  concurrency,
  strict
}, { runBuild = runRepoBuild } = {}) => {
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
  const worker = async () => {
    while (true) {
      if (strict && stopScheduling) return;
      const next = cursor;
      if (next >= targets.length) return;
      cursor += 1;
      const repo = targets[next];
      let result;
      try { result = await runBuild({ repo, buildArgs }); }
      catch (error) {
        result = { repoId: repo.repoId, repoRootCanonical: repo.repoRootCanonical, exitCode: null,
          signal: null, durationMs: 0, status: 'failed', error: error?.message || String(error) };
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
    .map(repo => ({ ...repo, status: 'skipped', reason: 'strict-failure' }));
  const failed = entries.filter(entry => entry.status !== 'passed').length;
  return {
    total: entries.length, failed, entries,
    configured: configured.length, selected: targets.length, attempted: entries.length,
    passed: entries.length - failed, skippedAfterFailure: skipped.length,
    excludedDisabled: excluded.length, skipped, excluded,
    outcome: targets.length === 0 ? 'no-work' : failed ? 'failed' : 'passed'
  };
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
  const diagnostics = await runWorkspaceBuildReport(workspaceConfig, options);
  const buildDiagnostics = diagnostics.entries;
  const failed = buildDiagnostics.filter((entry) => entry.status !== 'passed');
  const manifestResult = await generateWorkspaceManifest(workspaceConfig, { write: true });

  const payload = {
    ok: failed.length === 0,
    workspacePath: workspaceConfig.workspacePath,
    manifestPath: manifestResult.manifestPath,
    repoSetId: manifestResult.manifest.repoSetId,
    manifestHash: manifestResult.manifest.manifestHash,
    diagnostics
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error('Workspace build complete');
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
