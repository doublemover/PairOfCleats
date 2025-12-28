#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import { getDictionaryPaths, getDictConfig, getRepoCacheRoot, getToolingConfig, loadUserConfig } from './dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['skip-install', 'skip-dicts', 'skip-index', 'with-sqlite', 'incremental', 'skip-artifacts', 'skip-tooling'],
  alias: { s: 'with-sqlite', i: 'incremental' },
  default: {
    'skip-install': false,
    'skip-dicts': false,
    'skip-index': false,
    'with-sqlite': false,
    'incremental': false,
    'skip-artifacts': false,
    'skip-tooling': false
  }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const vectorExtension = getVectorExtensionConfig(root, userConfig);
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const incrementalCacheRoot = path.join(repoCacheRoot, 'incremental');
const useIncremental = argv.incremental || fs.existsSync(incrementalCacheRoot);
if (useIncremental) {
  console.log('[bootstrap] Incremental indexing enabled.');
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
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label || cmd}`);
    process.exit(result.status ?? 1);
  }
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
    run(process.execPath, [path.join('tools', 'download-dicts.js'), '--lang', 'en'], 'download English dictionary');
  }
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  if (dictionaryPaths.length) {
    console.log(`[bootstrap] Wordlists enabled (${dictionaryPaths.length} file(s)).`);
  } else {
    console.warn('[bootstrap] No wordlists found; identifier splitting will be limited.');
  }
}

if (vectorExtension.enabled) {
  const extPath = resolveVectorExtensionPath(vectorExtension);
  if (!extPath || !fs.existsSync(extPath)) {
    console.warn('[bootstrap] SQLite ANN extension missing; run npm run download-extensions to install.');
  } else {
    console.log(`[bootstrap] SQLite ANN extension found (${extPath}).`);
  }
}

if (!argv['skip-tooling']) {
  const toolingConfig = getToolingConfig(root, userConfig);
  const detectResult = spawnSync(
    process.execPath,
    [path.join('tools', 'tooling-detect.js'), '--root', root, '--json'],
    { encoding: 'utf8' }
  );
  if (detectResult.status === 0 && detectResult.stdout) {
    try {
      const report = JSON.parse(detectResult.stdout);
      const missingTools = Array.isArray(report.tools)
        ? report.tools.filter((tool) => tool && tool.found === false)
        : [];
      if (toolingConfig.autoInstallOnDetect && missingTools.length) {
        const installArgs = [path.join('tools', 'tooling-install.js'), '--root', root, '--scope', toolingConfig.installScope];
        if (!toolingConfig.allowGlobalFallback) installArgs.push('--no-fallback');
        run(process.execPath, installArgs, 'install tooling');
      } else if (missingTools.length) {
        console.log('[bootstrap] Optional tooling missing. Run npm run tooling-install to install.');
      }
    } catch {
      console.warn('[bootstrap] Failed to parse tooling detection output.');
    }
  } else if (detectResult.status !== 0) {
    console.warn('[bootstrap] Tooling detection failed.');
  }
}

if (!argv['skip-artifacts'] && fs.existsSync(path.join(artifactsDir, 'manifest.json'))) {
  const result = spawnSync(
    process.execPath,
    [path.join('tools', 'ci-restore-artifacts.js'), '--from', artifactsDir],
    { stdio: 'inherit' }
  );
  restoredArtifacts = result.status === 0;
}

if (!argv['skip-index'] && !restoredArtifacts) {
  const indexArgs = ['build_index.js'];
  if (useIncremental) indexArgs.push('--incremental');
  run(process.execPath, indexArgs, 'build index');
}

if (argv['with-sqlite']) {
  const sqliteArgs = [path.join('tools', 'build-sqlite-index.js')];
  if (useIncremental) sqliteArgs.push('--incremental');
  run(process.execPath, sqliteArgs, 'build sqlite index');
}

console.log('\nBootstrap complete.');
