#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import readline from 'node:readline/promises';
import {
  getDictionaryPaths,
  getDictConfig,
  getIndexDir,
  getModelConfig,
  getRepoCacheRoot,
  getToolingConfig,
  loadUserConfig
} from './dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

const argv = minimist(process.argv.slice(2), {
  boolean: [
    'non-interactive',
    'skip-install',
    'skip-dicts',
    'skip-models',
    'skip-extensions',
    'skip-tooling',
    'skip-index',
    'skip-sqlite',
    'skip-artifacts',
    'with-sqlite',
    'incremental'
  ],
  string: ['root', 'tooling-scope'],
  alias: { ci: 'non-interactive', s: 'with-sqlite', i: 'incremental' },
  default: {
    'non-interactive': false,
    'skip-install': false,
    'skip-dicts': false,
    'skip-models': false,
    'skip-extensions': false,
    'skip-tooling': false,
    'skip-index': false,
    'skip-sqlite': false,
    'skip-artifacts': false,
    'with-sqlite': false,
    incremental: false
  }
});

const root = path.resolve(argv.root || process.cwd());
const nonInteractive = argv['non-interactive'] === true;
const rl = nonInteractive ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

const log = (msg) => console.log(`[setup] ${msg}`);
const warn = (msg) => console.warn(`[setup] ${msg}`);

async function promptYesNo(question, defaultYes) {
  if (nonInteractive) return defaultYes;
  const suffix = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${suffix}] `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function promptChoice(question, choices, defaultChoice) {
  if (nonInteractive) return defaultChoice;
  const choiceList = choices.join('/');
  const answer = (await rl.question(`${question} (${choiceList}) [${defaultChoice}] `)).trim().toLowerCase();
  if (!answer) return defaultChoice;
  const normalized = answer === 'g' ? 'global' : answer === 'c' ? 'cache' : answer;
  const match = choices.find((choice) => choice.toLowerCase() === normalized);
  return match || defaultChoice;
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...options });
  return { ok: result.status === 0, status: result.status };
}

function runOrExit(label, cmd, args, options = {}) {
  const result = runCommand(cmd, args, options);
  if (!result.ok) {
    console.error(`[setup] Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

async function hasEntries(dirPath) {
  try {
    const entries = await fsPromises.readdir(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

log(`Starting setup in ${root}`);

const userConfig = loadUserConfig(root);
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const incrementalCacheRoot = path.join(repoCacheRoot, 'incremental');
const useIncremental = argv.incremental || fs.existsSync(incrementalCacheRoot);
if (useIncremental) log('Incremental indexing enabled.');

if (!argv['skip-install']) {
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    const shouldInstall = await promptYesNo('Install npm dependencies now?', true);
    if (shouldInstall) {
      runOrExit('npm install', 'npm', ['install']);
    } else {
      warn('Skipping npm install. Some commands may fail.');
    }
  } else {
    log('Dependencies already installed.');
  }
}

if (!argv['skip-dicts']) {
  const dictConfig = getDictConfig(root, userConfig);
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  const englishPath = path.join(dictConfig.dir, 'en.txt');
  const hasDicts = dictionaryPaths.length > 0;
  const needsEnglish = !fs.existsSync(englishPath);
  if (!hasDicts || needsEnglish) {
    const shouldDownload = await promptYesNo('Download English dictionary wordlist?', true);
    if (shouldDownload) {
      const result = runCommand(process.execPath, [path.join(root, 'tools', 'download-dicts.js'), '--lang', 'en']);
      if (!result.ok) warn('Dictionary download failed.');
    } else {
      warn('Skipping dictionary download. Identifier splitting will be limited.');
    }
  } else {
    log(`Dictionary files found (${dictionaryPaths.length}).`);
  }
}

if (!argv['skip-models']) {
  const modelConfig = getModelConfig(root, userConfig);
  const modelDir = modelConfig.dir;
  const hasModels = await hasEntries(modelDir);
  if (!hasModels) {
    const shouldDownload = await promptYesNo(`Download embedding model ${modelConfig.id}?`, true);
    if (shouldDownload) {
      const result = runCommand(process.execPath, [
        path.join(root, 'tools', 'download-models.js'),
        '--model',
        modelConfig.id,
        '--cache-dir',
        modelDir
      ]);
      if (!result.ok) warn('Model download failed.');
    } else {
      warn('Skipping model download. Embeddings may be stubbed.');
    }
  } else {
    log(`Model cache present (${modelDir}).`);
  }
}

if (!argv['skip-extensions']) {
  const vectorExtension = getVectorExtensionConfig(root, userConfig);
  if (vectorExtension.enabled) {
    const extPath = resolveVectorExtensionPath(vectorExtension);
    if (!extPath || !fs.existsSync(extPath)) {
      const shouldDownload = await promptYesNo('Download SQLite ANN extension?', true);
      if (shouldDownload) {
        const result = runCommand(process.execPath, [path.join(root, 'tools', 'download-extensions.js')]);
        if (!result.ok) warn('Extension download failed.');
      } else {
        warn('Skipping extension download. ANN acceleration will be unavailable.');
      }
    } else {
      log(`SQLite ANN extension present (${extPath}).`);
    }
  } else {
    log('SQLite ANN extension not enabled; skipping extension download.');
  }
}

if (!argv['skip-tooling']) {
  const toolingConfig = getToolingConfig(root, userConfig);
  const detectResult = spawnSync(
    process.execPath,
    [path.join(root, 'tools', 'tooling-detect.js'), '--root', root, '--json'],
    { encoding: 'utf8' }
  );
  if (detectResult.status === 0 && detectResult.stdout) {
    try {
      const report = JSON.parse(detectResult.stdout);
      const missing = Array.isArray(report.tools)
        ? report.tools.filter((tool) => tool && tool.found === false)
        : [];
      if (!missing.length) {
        log('Optional tooling already installed.');
      } else {
        log(`Missing tooling detected: ${missing.map((tool) => tool.id).join(', ')}`);
        const shouldInstall = await promptYesNo('Install missing tooling now?', true);
        if (shouldInstall) {
          const scopeDefault = argv['tooling-scope'] || toolingConfig.installScope || 'cache';
          const scope = await promptChoice('Install tooling scope', ['cache', 'global'], scopeDefault);
          const installArgs = [path.join(root, 'tools', 'tooling-install.js'), '--root', root, '--scope', scope];
          if (!toolingConfig.allowGlobalFallback) installArgs.push('--no-fallback');
          const result = runCommand(process.execPath, installArgs);
          if (!result.ok) warn('Tooling install failed.');
        } else {
          warn('Skipping tooling install.');
        }
      }
    } catch {
      warn('Failed to parse tooling detection output.');
    }
  } else {
    warn('Tooling detection failed.');
  }
}

let restoredArtifacts = false;
if (!argv['skip-artifacts']) {
  const artifactsDir = path.join(root, 'ci-artifacts');
  const manifestPath = path.join(artifactsDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const shouldRestore = await promptYesNo('Restore CI artifacts from ci-artifacts?', true);
    if (shouldRestore) {
      const result = runCommand(process.execPath, [path.join(root, 'tools', 'ci-restore-artifacts.js'), '--from', artifactsDir]);
      restoredArtifacts = result.ok;
      if (!result.ok) warn('CI artifact restore failed.');
    }
  }
}

const codeIndexDir = getIndexDir(root, 'code', userConfig);
const proseIndexDir = getIndexDir(root, 'prose', userConfig);
const codeIndexPresent = fs.existsSync(path.join(codeIndexDir, 'chunk_meta.json'));
const proseIndexPresent = fs.existsSync(path.join(proseIndexDir, 'chunk_meta.json'));
let indexReady = restoredArtifacts || codeIndexPresent || proseIndexPresent;

if (!argv['skip-index'] && !restoredArtifacts) {
  const shouldBuild = await promptYesNo(
    indexReady ? 'Index artifacts already exist. Rebuild now?' : 'Build index now?',
    !indexReady
  );
  if (shouldBuild) {
    const args = [path.join(root, 'build_index.js')];
    if (useIncremental) args.push('--incremental');
    const result = runCommand(process.execPath, args);
    if (!result.ok) warn('Index build failed.');
    indexReady = indexReady || result.ok;
  }
}

if (!argv['skip-sqlite']) {
  const sqliteConfigured = userConfig.sqlite?.use === true;
  const sqliteDefault = argv['with-sqlite'] ? true : sqliteConfigured;
  const shouldBuildSqlite = argv['with-sqlite']
    ? true
    : await promptYesNo('Build SQLite indexes now?', sqliteDefault);
  if (shouldBuildSqlite) {
    if (!indexReady) {
      const shouldBuildIndex = await promptYesNo('SQLite build requires file-backed indexes. Build index now?', true);
      if (shouldBuildIndex && !argv['skip-index']) {
        const args = [path.join(root, 'build_index.js')];
        if (useIncremental) args.push('--incremental');
        const result = runCommand(process.execPath, args);
        if (!result.ok) warn('Index build failed; skipping SQLite build.');
        indexReady = indexReady || result.ok;
      }
    }
    if (indexReady) {
      const sqliteArgs = [path.join(root, 'tools', 'build-sqlite-index.js')];
      if (useIncremental) sqliteArgs.push('--incremental');
      const result = runCommand(process.execPath, sqliteArgs);
      if (!result.ok) warn('SQLite build failed.');
    } else {
      warn('SQLite build skipped; file-backed indexes missing.');
    }
  }
}

if (rl) rl.close();

log('Setup complete.');
