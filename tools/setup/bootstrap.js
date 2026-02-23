#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createStdoutGuard } from '../../src/shared/cli/stdout-guard.js';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { runCommand } from '../shared/cli-utils.js';
import { getDictionaryPaths, getDictConfig, getRepoCacheRoot, getRuntimeConfig, getToolingConfig, resolveRepoConfig, resolveRuntimeEnv, resolveToolRoot } from '../shared/dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../sqlite/vector-extension.js';

const argv = createCli({
  scriptName: 'bootstrap',
  options: {
    'skip-install': { type: 'boolean', default: false },
    'skip-dicts': { type: 'boolean', default: false },
    'skip-index': { type: 'boolean', default: false },
    'with-sqlite': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    'skip-artifacts': { type: 'boolean', default: false },
    'skip-tooling': { type: 'boolean', default: false },
    'validate-config': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    repo: { type: 'string' }
  },
  aliases: { s: 'with-sqlite', i: 'incremental' }
}).parse();

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const toolRoot = resolveToolRoot();
const jsonOutput = argv.json === true;
const stdoutGuard = createStdoutGuard({ enabled: jsonOutput, stream: process.stdout, label: 'bootstrap stdout' });
const summary = {
  root,
  incremental: false,
  restoredArtifacts: false,
  steps: {}
};

const recordStep = (name, data) => {
  summary.steps[name] = { ...(summary.steps[name] || {}), ...data };
};

/**
 * Execute a child process while keeping JSON mode stdout clean.
 *
 * In `--json` mode we must reserve stdout for the final JSON payload, so
 * all child stdout/stderr is redirected to stderr.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?:string,env?:NodeJS.ProcessEnv}} [options]
 * @returns {Promise<{ok:boolean,status:number|null}>}
 */
const streamChildOutputToStderr = async (cmd, args, { cwd = root, env = process.env } = {}) => {
  // execaSync defaults to 100 MB maxBuffer; raise the Windows npm fallback cap
  // so `bootstrap --json` does not fail before emitting the final summary.
  if (process.platform === 'win32' && String(cmd || '').toLowerCase() === 'npm') {
    const npmResult = runCommand(cmd, args, {
      cwd,
      env,
      stdio: 'pipe',
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024
    });
    relayChildOutputToStderr(npmResult);
    return {
      ok: npmResult.ok,
      status: npmResult.status ?? null
    };
  }
  const result = await spawnSubprocess(cmd, args, {
    cwd,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
    captureStdout: false,
    captureStderr: false,
    onStdout: (chunk) => process.stderr.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
    rejectOnNonZeroExit: false
  });
  return {
    ok: result.exitCode === 0,
    status: result.exitCode ?? null
  };
};

/**
 * Mirror captured child output to stderr in JSON mode only.
 *
 * @param {{stdout?:string,stderr?:string}|null|undefined} result
 */
const relayChildOutputToStderr = (result) => {
  if (!jsonOutput || !result || typeof result !== 'object') return;
  if (typeof result.stdout === 'string' && result.stdout.length > 0) {
    process.stderr.write(result.stdout);
  }
  if (typeof result.stderr === 'string' && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
};

const configPath = path.join(root, '.pairofcleats.json');
if (argv['validate-config'] && fs.existsSync(configPath)) {
  const result = jsonOutput
    ? await streamChildOutputToStderr(
      process.execPath,
      [path.join(toolRoot, 'tools', 'config', 'validate.js'), '--config', configPath],
      { cwd: root, env: process.env }
    )
    : runCommand(
      process.execPath,
      [path.join(toolRoot, 'tools', 'config', 'validate.js'), '--config', configPath],
      { cwd: root, stdio: 'inherit', encoding: 'utf8' }
    );
  if (!jsonOutput) {
    relayChildOutputToStderr(result);
  }
  if (!result.ok) {
    process.exit(result.status ?? 1);
  }
}

const runtimeConfig = getRuntimeConfig(root, userConfig);
const baseEnv = resolveRuntimeEnv(runtimeConfig, process.env);
const vectorExtension = getVectorExtensionConfig(root, userConfig);
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const incrementalCacheRoot = path.join(repoCacheRoot, 'incremental');
const useIncremental = argv.incremental || fs.existsSync(incrementalCacheRoot);
summary.incremental = useIncremental;
if (useIncremental) {
  console.error('[bootstrap] Incremental indexing enabled.');
}
const artifactsDir = path.join(root, 'ci-artifacts');
let restoredArtifacts = false;

/**
 * Run a bootstrap step under the resolved runtime environment and abort on
 * non-zero exit.
 *
 * In `--json` mode child output is routed to stderr so stdout remains a single
 * machine-parseable summary payload.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} label
 */
async function run(cmd, args, label) {
  const result = jsonOutput
    ? await streamChildOutputToStderr(cmd, args, { cwd: root, env: baseEnv })
    : runCommand(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      encoding: 'utf8',
      env: baseEnv
    });
  if (!jsonOutput) {
    relayChildOutputToStderr(result);
  }
  if (!result.ok) {
    console.error(`Failed: ${label || cmd}`);
    process.exit(result.status ?? 1);
  }
}

if (!argv['skip-install']) {
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    await run('npm', ['install'], 'npm install');
    recordStep('install', { skipped: false, installed: true });
  } else {
    recordStep('install', { skipped: false, installed: false });
  }
} else {
  recordStep('install', { skipped: true });
}

if (!argv['skip-dicts']) {
  const dictConfig = getDictConfig(root, userConfig);
  const englishPath = path.join(dictConfig.dir, 'en.txt');
  if (!fs.existsSync(englishPath)) {
    await run(process.execPath, [path.join(toolRoot, 'tools', 'download', 'dicts.js'), '--lang', 'en'], 'download English dictionary');
  }
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  if (dictionaryPaths.length) {
    console.error(`[bootstrap] Wordlists enabled (${dictionaryPaths.length} file(s)).`);
    recordStep('dictionaries', { skipped: false, available: true, count: dictionaryPaths.length });
  } else {
    console.warn('[bootstrap] No wordlists found; identifier splitting will be limited.');
    recordStep('dictionaries', { skipped: false, available: false, count: 0 });
  }
} else {
  recordStep('dictionaries', { skipped: true });
}

if (vectorExtension.enabled) {
  const extPath = resolveVectorExtensionPath(vectorExtension);
  if (!extPath || !fs.existsSync(extPath)) {
    console.warn('[bootstrap] SQLite ANN extension missing; run node tools/download/extensions.js to install.');
    recordStep('extensions', { skipped: false, available: false });
  } else {
    console.error(`[bootstrap] SQLite ANN extension found (${extPath}).`);
    recordStep('extensions', { skipped: false, available: true, path: extPath });
  }
} else {
  recordStep('extensions', { skipped: true, enabled: false });
}

if (!argv['skip-tooling']) {
  const toolingConfig = getToolingConfig(root, userConfig);
  const detectResult = runCommand(
    process.execPath,
    [path.join(toolRoot, 'tools', 'tooling', 'detect.js'), '--root', root, '--json'],
    { cwd: root, encoding: 'utf8', stdio: 'pipe', env: baseEnv }
  );
  if (detectResult.status === 0 && detectResult.stdout) {
    try {
      const report = JSON.parse(detectResult.stdout);
      const missingTools = Array.isArray(report.tools)
        ? report.tools.filter((tool) => tool && tool.found === false)
        : [];
      if (toolingConfig.autoInstallOnDetect && missingTools.length) {
        const installArgs = [path.join(toolRoot, 'tools', 'tooling', 'install.js'), '--root', root, '--scope', toolingConfig.installScope];
        if (!toolingConfig.allowGlobalFallback) installArgs.push('--no-fallback');
        await run(process.execPath, installArgs, 'install tooling');
      } else if (missingTools.length) {
        console.error('[bootstrap] Optional tooling missing. Run node tools/tooling/install.js to install.');
      }
    } catch {
      console.warn('[bootstrap] Failed to parse tooling detection output.');
      recordStep('tooling', { skipped: false, detectParsed: false });
    }
  } else if (detectResult.status !== 0) {
    console.warn('[bootstrap] Tooling detection failed.');
    recordStep('tooling', { skipped: false, detectOk: false });
  }

  const pyrightEnsureArgs = [
    path.join(toolRoot, 'tools', 'tooling', 'install.js'),
    '--root',
    root,
    '--tools',
    'pyright',
    '--scope',
    toolingConfig.installScope || 'cache',
    '--json'
  ];
  if (!toolingConfig.allowGlobalFallback) pyrightEnsureArgs.push('--no-fallback');
  const pyrightEnsure = runCommand(process.execPath, pyrightEnsureArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: baseEnv
  });
  if (pyrightEnsure.status === 0) {
    try {
      const payload = JSON.parse(pyrightEnsure.stdout || '{}');
      const pyrightResult = Array.isArray(payload.results)
        ? payload.results.find((entry) => entry && entry.id === 'pyright')
        : null;
      const status = pyrightResult?.status;
      if (status === 'installed') {
        console.error('[bootstrap] Installed pyright tooling (pyright-langserver).');
      } else if (status === 'already-installed') {
        console.error('[bootstrap] pyright-langserver already available.');
      } else if (status && status !== 'manual') {
        console.warn(`[bootstrap] pyright tooling ensure status: ${status}.`);
      }
    } catch {
      console.warn('[bootstrap] Failed to parse pyright tooling ensure output.');
      recordStep('tooling', { skipped: false, pyrightEnsureParsed: false });
    }
  } else {
    console.warn('[bootstrap] Failed to ensure pyright tooling; pyright-langserver may be unavailable.');
    recordStep('tooling', { skipped: false, pyrightEnsureOk: false });
  }
} else {
  recordStep('tooling', { skipped: true });
}

if (!argv['skip-artifacts'] && fs.existsSync(path.join(artifactsDir, 'manifest.json'))) {
  const result = jsonOutput
    ? await streamChildOutputToStderr(
      process.execPath,
      [path.join(toolRoot, 'tools', 'ci', 'restore-artifacts.js'), '--from', artifactsDir],
      { cwd: root, env: baseEnv }
    )
    : runCommand(
      process.execPath,
      [path.join(toolRoot, 'tools', 'ci', 'restore-artifacts.js'), '--from', artifactsDir],
      { cwd: root, stdio: 'inherit', encoding: 'utf8', env: baseEnv }
    );
  if (!jsonOutput) {
    relayChildOutputToStderr(result);
  }
  restoredArtifacts = result.ok;
}
summary.restoredArtifacts = restoredArtifacts;
recordStep('artifacts', { skipped: argv['skip-artifacts'] === true, restored: restoredArtifacts });

if (!argv['skip-index'] && !restoredArtifacts) {
  const indexArgs = [path.join(toolRoot, 'build_index.js')];
  if (useIncremental) indexArgs.push('--incremental');
  await run(process.execPath, indexArgs, 'build index');
  recordStep('index', { skipped: false, built: true });
} else {
  recordStep('index', { skipped: argv['skip-index'] === true, built: false });
}

if (argv['with-sqlite']) {
  const sqliteArgs = [path.join(toolRoot, 'build_index.js'), '--stage', '4'];
  if (useIncremental) sqliteArgs.push('--incremental');
  await run(process.execPath, sqliteArgs, 'build sqlite index');
  recordStep('sqlite', { skipped: false, built: true });
} else {
  recordStep('sqlite', { skipped: true, built: false });
}

console.error('[bootstrap] Tip: run pairofcleats index validate to verify index artifacts.');
console.error('\nBootstrap complete.');
if (jsonOutput) {
  stdoutGuard.writeJson(summary);
}
