#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { runCommand, runCommandOrExit } from '../shared/cli-utils.js';
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
    repo: { type: 'string' }
  },
  aliases: { s: 'with-sqlite', i: 'incremental' }
}).parse();

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const toolRoot = resolveToolRoot();
const configPath = path.join(root, '.pairofcleats.json');
if (argv['validate-config'] && fs.existsSync(configPath)) {
  const result = runCommand(
    process.execPath,
    [path.join(toolRoot, 'tools', 'config', 'validate.js'), '--config', configPath],
    { cwd: root, stdio: 'inherit' }
  );
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
if (useIncremental) {
  console.error('[bootstrap] Incremental indexing enabled.');
}
const artifactsDir = path.join(root, 'ci-artifacts');
let restoredArtifacts = false;

/**
 * Run a command and exit on failure.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} label
 */
function run(cmd, args, label) {
  runCommandOrExit(label || cmd, cmd, args, { cwd: root, stdio: 'inherit', env: baseEnv });
}

if (!argv['skip-install']) {
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    run('npm', ['install'], 'npm install');
  }
}

if (!argv['skip-dicts']) {
  const dictConfig = getDictConfig(root, userConfig);
  const englishPath = path.join(dictConfig.dir, 'en.txt');
  if (!fs.existsSync(englishPath)) {
    run(process.execPath, [path.join(toolRoot, 'tools', 'download', 'dicts.js'), '--lang', 'en'], 'download English dictionary');
  }
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  if (dictionaryPaths.length) {
    console.error(`[bootstrap] Wordlists enabled (${dictionaryPaths.length} file(s)).`);
  } else {
    console.warn('[bootstrap] No wordlists found; identifier splitting will be limited.');
  }
}

if (vectorExtension.enabled) {
  const extPath = resolveVectorExtensionPath(vectorExtension);
  if (!extPath || !fs.existsSync(extPath)) {
    console.warn('[bootstrap] SQLite ANN extension missing; run node tools/download/extensions.js to install.');
  } else {
    console.error(`[bootstrap] SQLite ANN extension found (${extPath}).`);
  }
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
        run(process.execPath, installArgs, 'install tooling');
      } else if (missingTools.length) {
        console.error('[bootstrap] Optional tooling missing. Run node tools/tooling/install.js to install.');
      }
    } catch {
      console.warn('[bootstrap] Failed to parse tooling detection output.');
    }
  } else if (detectResult.status !== 0) {
    console.warn('[bootstrap] Tooling detection failed.');
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
    }
  } else {
    console.warn('[bootstrap] Failed to ensure pyright tooling; pyright-langserver may be unavailable.');
  }
}

if (!argv['skip-artifacts'] && fs.existsSync(path.join(artifactsDir, 'manifest.json'))) {
  const result = runCommand(
    process.execPath,
    [path.join(toolRoot, 'tools', 'ci', 'restore-artifacts.js'), '--from', artifactsDir],
    { cwd: root, stdio: 'inherit', env: baseEnv }
  );
  restoredArtifacts = result.ok;
}

if (!argv['skip-index'] && !restoredArtifacts) {
  const indexArgs = [path.join(toolRoot, 'build_index.js')];
  if (useIncremental) indexArgs.push('--incremental');
  run(process.execPath, indexArgs, 'build index');
}

if (argv['with-sqlite']) {
  const sqliteArgs = [path.join(toolRoot, 'build_index.js'), '--stage', '4'];
  if (useIncremental) sqliteArgs.push('--incremental');
  run(process.execPath, sqliteArgs, 'build sqlite index');
}

console.error('[bootstrap] Tip: run pairofcleats index validate to verify index artifacts.');
console.error('\nBootstrap complete.');
