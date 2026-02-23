#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD_INDEX_SCRIPT = path.join(TOOL_ROOT, 'build_index.js');
const MAX_WORKSPACE_BUILD_CONCURRENCY = 32;

const parseRawWorkspaceBuildArgs = (rawArgs) => {
  const buildArgs = [];
  let workspacePath = '';
  let concurrency = 2;
  let strict = false;
  let includeDisabled = false;
  let json = false;

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
    const workspaceValue = readValue(arg, i, 'workspace');
    if (workspaceValue) {
      workspacePath = workspaceValue.value;
      i += workspaceValue.skip;
      continue;
    }
    const concurrencyValue = readValue(arg, i, 'concurrency');
    if (concurrencyValue) {
      const parsed = Number(concurrencyValue.value);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --concurrency value: ${concurrencyValue.value}`);
      }
      concurrency = Math.min(MAX_WORKSPACE_BUILD_CONCURRENCY, Math.max(1, Math.floor(parsed)));
      i += concurrencyValue.skip;
      continue;
    }
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg === '--include-disabled') {
      includeDisabled = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    buildArgs.push(arg);
  }

  if (!workspacePath) {
    throw new Error('workspace build requires --workspace <path>.');
  }
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

const runRepoBuild = async ({ repo, buildArgs }) => {
  const startedAt = Date.now();
  const result = await spawnSubprocess(
    process.execPath,
    [BUILD_INDEX_SCRIPT, ...buildArgs, '--repo', repo.repoRootCanonical],
    {
      cwd: repo.repoRootCanonical,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      captureStdout: false,
      captureStderr: true,
      maxOutputBytes: 64 * 1024,
      rejectOnNonZeroExit: false
    }
  );
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  const exitCode = Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : null;
  const signal = typeof result.signal === 'string' && result.signal.trim().length > 0
    ? result.signal.trim()
    : null;
  return {
    repoId: repo.repoId,
    repoRootCanonical: repo.repoRootCanonical,
    exitCode: exitCode ?? 1,
    signal,
    durationMs: Date.now() - startedAt,
    status: exitCode === 0 && !signal ? 'passed' : 'failed',
    error: (exitCode === 0 && !signal)
      ? null
      : (stderr || (signal ? `build_index exited via signal ${signal}` : `build_index exited with code ${result.exitCode}`))
  };
};

const runWorkspaceBuild = async (workspaceConfig, {
  buildArgs,
  includeDisabled,
  concurrency,
  strict
}) => {
  const targets = workspaceConfig.repos
    .filter((repo) => includeDisabled || repo.enabled)
    .slice()
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
      const result = await runRepoBuild({ repo, buildArgs });
      results[next] = result;
      if (strict && result.exitCode !== 0) {
        stopScheduling = true;
      }
    }
  };

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results.filter(Boolean).sort((a, b) => a.repoId.localeCompare(b.repoId));
};

export async function runWorkspaceBuildCli(rawArgs = process.argv.slice(2)) {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printWorkspaceBuildHelp();
    return;
  }
  const options = parseRawWorkspaceBuildArgs(rawArgs);
  const workspaceConfig = loadWorkspaceConfig(options.workspacePath);
  const buildDiagnostics = await runWorkspaceBuild(workspaceConfig, options);
  const failed = buildDiagnostics.filter((entry) => entry.status !== 'passed');
  const manifestResult = await generateWorkspaceManifest(workspaceConfig, { write: true });

  const payload = {
    ok: failed.length === 0,
    workspacePath: workspaceConfig.workspacePath,
    manifestPath: manifestResult.manifestPath,
    repoSetId: manifestResult.manifest.repoSetId,
    manifestHash: manifestResult.manifest.manifestHash,
    diagnostics: {
      total: buildDiagnostics.length,
      failed: failed.length,
      entries: buildDiagnostics
    }
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error('Workspace build complete');
    console.error(`- workspace: ${payload.workspacePath}`);
    console.error(`- repos built: ${payload.diagnostics.total}`);
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
  }

  if (failed.length > 0) {
    const firstSignal = failed.find((entry) => typeof entry?.signal === 'string' && entry.signal.trim().length > 0)?.signal || null;
    if (firstSignal) {
      exitLikeCommandResult({ status: null, signal: firstSignal });
    }
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkspaceBuildCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
