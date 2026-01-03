#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCli } from '../src/shared/cli.js';
import readline from 'node:readline/promises';
import {
  getDictionaryPaths,
  getDictConfig,
  getIndexDir,
  getModelConfig,
  getRepoCacheRoot,
  getRuntimeConfig,
  getToolingConfig,
  loadUserConfig,
  resolveNodeOptions,
  resolveRepoRoot
} from './dict-utils.js';
import { runCommand as runCommandBase } from './cli-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

const argv = createCli({
  scriptName: 'setup',
  options: {
    json: { type: 'boolean', default: false },
    'non-interactive': { type: 'boolean', default: false },
    'validate-config': { type: 'boolean', default: false },
    'skip-validate': { type: 'boolean', default: false },
    'skip-install': { type: 'boolean', default: false },
    'skip-dicts': { type: 'boolean', default: false },
    'skip-models': { type: 'boolean', default: false },
    'skip-extensions': { type: 'boolean', default: false },
    'skip-tooling': { type: 'boolean', default: false },
    'skip-index': { type: 'boolean', default: false },
    'skip-sqlite': { type: 'boolean', default: false },
    'skip-artifacts': { type: 'boolean', default: false },
    'with-sqlite': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    root: { type: 'string' },
    repo: { type: 'string' },
    'tooling-scope': { type: 'string' },
    'heap-mb': { type: 'string' }
  },
  aliases: { ci: 'non-interactive', s: 'with-sqlite', i: 'incremental' }
}).parse();

const explicitRoot = argv.root || argv.repo;
const root = explicitRoot ? path.resolve(explicitRoot) : resolveRepoRoot(process.cwd());
const jsonOutput = argv.json === true;
const nonInteractive = argv['non-interactive'] === true;
const rl = nonInteractive ? null : readline.createInterface({ input: process.stdin, output: process.stdout });

const log = (msg) => {
  const line = `[setup] ${msg}`;
  if (jsonOutput) console.error(line);
  else console.log(line);
};
const warn = (msg) => {
  const line = `[setup] ${msg}`;
  if (jsonOutput) console.error(line);
  else console.warn(line);
};

const summary = {
  root,
  nonInteractive,
  incremental: false,
  steps: {},
  errors: []
};

function recordStep(name, data) {
  summary.steps[name] = { ...(summary.steps[name] || {}), ...data };
}

function recordError(step, result, message) {
  summary.errors.push({
    step,
    status: result?.status ?? null,
    message: message || null,
    stderr: result?.stderr ? String(result.stderr).trim() : null
  });
}

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

function formatGb(mb) {
  return `${(mb / 1024).toFixed(1)} GB`;
}

function getRecommendedHeapMb() {
  const totalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const recommended = Math.max(4096, Math.floor(totalMb * 0.75));
  const rounded = Math.floor(recommended / 256) * 256;
  return {
    totalMb,
    recommendedMb: Math.max(4096, rounded)
  };
}

async function updateRuntimeConfig(maxOldSpaceMb) {
  const existing = configExists
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};
  const next = {
    ...existing,
    runtime: {
      ...(existing.runtime || {}),
      maxOldSpaceMb
    }
  };
  await fsPromises.writeFile(configPath, JSON.stringify(next, null, 2));
  configExists = true;
  return next;
}

function buildRuntimeEnv(config) {
  const runtimeConfig = getRuntimeConfig(root, config);
  const nodeOptions = resolveNodeOptions(runtimeConfig, process.env.NODE_OPTIONS || '');
  return nodeOptions ? { ...process.env, NODE_OPTIONS: nodeOptions } : { ...process.env };
}

let runtimeEnv = { ...process.env };

function runCommand(cmd, args, options = {}) {
  const spawnOptions = {
    cwd: root,
    ...options,
    env: { ...runtimeEnv, ...(options.env || {}) }
  };
  if (!('stdio' in spawnOptions)) {
    spawnOptions.stdio = jsonOutput ? 'pipe' : 'inherit';
  }
  if (jsonOutput && !('encoding' in spawnOptions)) {
    spawnOptions.encoding = 'utf8';
  }
  return runCommandBase(cmd, args, spawnOptions);
}

function runOrExit(label, cmd, args, options = {}) {
  const result = runCommand(cmd, args, options);
  if (!result.ok) {
    recordError(label, result, 'command failed');
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

const configPath = path.join(root, '.pairofcleats.json');
let configExists = fs.existsSync(configPath);
let shouldValidateConfig = argv['validate-config'] === true;
if (!argv['skip-validate'] && configExists && !shouldValidateConfig && !nonInteractive) {
  shouldValidateConfig = await promptYesNo('Validate .pairofcleats.json now?', true);
}
if (argv['skip-validate']) shouldValidateConfig = false;

if (shouldValidateConfig && configExists) {
  const args = [path.join(root, 'tools', 'validate-config.js'), '--config', configPath];
  if (jsonOutput) args.push('--json');
  const result = runCommand(process.execPath, args);
  recordStep('config', { skipped: false, ok: result.ok, configPath });
  if (!result.ok) {
    recordError('config', result, 'validation failed');
    const continueSetup = nonInteractive
      ? false
      : await promptYesNo('Config validation failed. Continue setup anyway?', false);
    if (!continueSetup) {
      if (rl) await rl.close();
      process.exit(result.status ?? 1);
    }
  }
} else {
  recordStep('config', { skipped: true, present: configExists, configPath });
}

let userConfig = loadUserConfig(root);
runtimeEnv = buildRuntimeEnv(userConfig);
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const incrementalCacheRoot = path.join(repoCacheRoot, 'incremental');
const useIncremental = argv.incremental || fs.existsSync(incrementalCacheRoot);
summary.incremental = useIncremental;
if (useIncremental) log('Incremental indexing enabled.');

const heapArgRaw = argv['heap-mb'];
const heapArg = Number.isFinite(Number(heapArgRaw)) ? Number(heapArgRaw) : null;
const currentHeap = Number(userConfig.runtime?.maxOldSpaceMb);
const heapConfigured = Number.isFinite(currentHeap) && currentHeap > 0;
const heapRecommendation = getRecommendedHeapMb();
let runtimeUpdated = false;
let heapValue = heapConfigured ? currentHeap : null;

if (Number.isFinite(heapArg) && heapArg > 0) {
  userConfig = await updateRuntimeConfig(Math.floor(heapArg));
  runtimeEnv = buildRuntimeEnv(userConfig);
  runtimeUpdated = true;
  heapValue = Math.floor(heapArg);
  log(`Configured Node heap limit at ${formatGb(heapValue)}.`);
} else if (!heapConfigured) {
  const defaultYes = heapRecommendation.totalMb >= 16384;
  const shouldSet = await promptYesNo(
    `Set Node heap limit to ${formatGb(heapRecommendation.recommendedMb)}?`,
    defaultYes
  );
  if (shouldSet) {
    userConfig = await updateRuntimeConfig(heapRecommendation.recommendedMb);
    runtimeEnv = buildRuntimeEnv(userConfig);
    runtimeUpdated = true;
    heapValue = heapRecommendation.recommendedMb;
    log(`Configured Node heap limit at ${formatGb(heapValue)}.`);
  }
}
recordStep('runtime', {
  configured: runtimeUpdated || heapConfigured,
  maxOldSpaceMb: heapValue,
  recommendedMb: heapRecommendation.recommendedMb,
  skipped: !(runtimeUpdated || heapConfigured)
});

const nodeModules = path.join(root, 'node_modules');
if (argv['skip-install']) {
  recordStep('install', { skipped: true, present: fs.existsSync(nodeModules) });
} else if (!fs.existsSync(nodeModules)) {
  const shouldInstall = await promptYesNo('Install npm dependencies now?', true);
  if (shouldInstall) {
    runOrExit('install', 'npm', ['install']);
    recordStep('install', { skipped: false, present: true, installed: true });
  } else {
    warn('Skipping npm install. Some commands may fail.');
    recordStep('install', { skipped: false, present: false, installed: false });
  }
} else {
  log('Dependencies already installed.');
  recordStep('install', { skipped: false, present: true, installed: false });
}

if (argv['skip-dicts']) {
  recordStep('dictionaries', { skipped: true });
} else {
  const dictConfig = getDictConfig(root, userConfig);
  const dictionaryPaths = await getDictionaryPaths(root, dictConfig);
  const englishPath = path.join(dictConfig.dir, 'en.txt');
  const hasDicts = dictionaryPaths.length > 0;
  const needsEnglish = !fs.existsSync(englishPath);
  let downloaded = false;
  if (!hasDicts || needsEnglish) {
    const shouldDownload = await promptYesNo('Download English dictionary wordlist?', true);
    if (shouldDownload) {
      const result = runCommand(process.execPath, [path.join(root, 'tools', 'download-dicts.js'), '--lang', 'en']);
      if (!result.ok) {
        warn('Dictionary download failed.');
        recordError('dictionaries', result, 'download failed');
      } else {
        downloaded = true;
      }
    } else {
      warn('Skipping dictionary download. Identifier splitting will be limited.');
    }
  } else {
    log(`Dictionary files found (${dictionaryPaths.length}).`);
  }
  recordStep('dictionaries', {
    skipped: false,
    present: hasDicts,
    downloaded
  });
}

if (argv['skip-models']) {
  recordStep('models', { skipped: true });
} else {
  const modelConfig = getModelConfig(root, userConfig);
  const modelDir = modelConfig.dir;
  const hasModels = await hasEntries(modelDir);
  let downloaded = false;
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
      if (!result.ok) {
        warn('Model download failed.');
        recordError('models', result, 'download failed');
      } else {
        downloaded = true;
      }
    } else {
      warn('Skipping model download. Embeddings may be stubbed.');
    }
  } else {
    log(`Model cache present (${modelDir}).`);
  }
  recordStep('models', { skipped: false, present: hasModels, downloaded });
}

if (argv['skip-extensions']) {
  recordStep('extensions', { skipped: true });
} else {
  const vectorExtension = getVectorExtensionConfig(root, userConfig);
  if (vectorExtension.enabled) {
    const extPath = resolveVectorExtensionPath(vectorExtension);
    const hasExtension = !!(extPath && fs.existsSync(extPath));
    let downloaded = false;
    if (!hasExtension) {
      const shouldDownload = await promptYesNo('Download SQLite ANN extension?', true);
      if (shouldDownload) {
        const result = runCommand(process.execPath, [path.join(root, 'tools', 'download-extensions.js')]);
        if (!result.ok) {
          warn('Extension download failed.');
          recordError('extensions', result, 'download failed');
        } else {
          downloaded = true;
        }
      } else {
        warn('Skipping extension download. ANN acceleration will be unavailable.');
      }
    } else {
      log(`SQLite ANN extension present (${extPath}).`);
    }
    recordStep('extensions', {
      skipped: false,
      enabled: true,
      present: hasExtension,
      downloaded
    });
  } else {
    log('SQLite ANN extension not enabled; skipping extension download.');
    recordStep('extensions', { skipped: true, enabled: false });
  }
}

if (argv['skip-tooling']) {
  recordStep('tooling', { skipped: true });
} else {
  const toolingConfig = getToolingConfig(root, userConfig);
  let toolingMissing = [];
  let toolingInstalled = false;
  const detectResult = runCommand(
    process.execPath,
    [path.join(root, 'tools', 'tooling-detect.js'), '--root', root, '--json'],
    { encoding: 'utf8', stdio: 'pipe' }
  );
  if (detectResult.status === 0 && detectResult.stdout) {
    try {
      const report = JSON.parse(detectResult.stdout);
      toolingMissing = Array.isArray(report.tools)
        ? report.tools.filter((tool) => tool && tool.found === false)
        : [];
      if (!toolingMissing.length) {
        log('Optional tooling already installed.');
      } else {
        log(`Missing tooling detected: ${toolingMissing.map((tool) => tool.id).join(', ')}`);
        const shouldInstall = await promptYesNo('Install missing tooling now?', true);
        if (shouldInstall) {
          const scopeDefault = argv['tooling-scope'] || toolingConfig.installScope || 'cache';
          const scope = await promptChoice('Install tooling scope', ['cache', 'global'], scopeDefault);
          const installArgs = [path.join(root, 'tools', 'tooling-install.js'), '--root', root, '--scope', scope];
          if (!toolingConfig.allowGlobalFallback) installArgs.push('--no-fallback');
          const result = runCommand(process.execPath, installArgs);
          if (!result.ok) {
            warn('Tooling install failed.');
            recordError('tooling', result, 'install failed');
          } else {
            toolingInstalled = true;
          }
        } else {
          warn('Skipping tooling install.');
        }
      }
    } catch {
      warn('Failed to parse tooling detection output.');
      recordError('tooling', detectResult, 'parse failed');
    }
  } else {
    warn('Tooling detection failed.');
    recordError('tooling', detectResult, 'detect failed');
  }
  recordStep('tooling', {
    skipped: false,
    missing: toolingMissing.map((tool) => tool.id),
    installed: toolingInstalled
  });
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
      if (!result.ok) {
        warn('CI artifact restore failed.');
        recordError('artifacts', result, 'restore failed');
      }
    }
  }
}
recordStep('artifacts', {
  skipped: argv['skip-artifacts'] === true,
  restored: restoredArtifacts
});

const codeIndexDir = getIndexDir(root, 'code', userConfig);
const proseIndexDir = getIndexDir(root, 'prose', userConfig);
const codeIndexPresent = fs.existsSync(path.join(codeIndexDir, 'chunk_meta.json'));
const proseIndexPresent = fs.existsSync(path.join(proseIndexDir, 'chunk_meta.json'));
let indexReady = restoredArtifacts || codeIndexPresent || proseIndexPresent;
let indexBuilt = false;
let indexBuildOk = true;

if (!argv['skip-index'] && !restoredArtifacts) {
  const shouldBuild = await promptYesNo(
    indexReady ? 'Index artifacts already exist. Rebuild now?' : 'Build index now?',
    !indexReady
  );
  if (shouldBuild) {
    const args = [path.join(root, 'build_index.js')];
    if (useIncremental) args.push('--incremental');
    const result = runCommand(process.execPath, args);
    if (!result.ok) {
      warn('Index build failed.');
      recordError('index', result, 'build failed');
      indexBuildOk = false;
    }
    indexReady = indexReady || result.ok;
    indexBuilt = true;
  }
}

let sqliteBuilt = false;
let sqliteOk = true;
if (!argv['skip-sqlite']) {
  const sqliteConfigured = userConfig.sqlite?.use !== false;
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
        if (!result.ok) {
          warn('Index build failed; skipping SQLite build.');
          recordError('index', result, 'build failed (sqlite dependency)');
          indexBuildOk = false;
        }
        indexReady = indexReady || result.ok;
        indexBuilt = true;
      }
    }
    if (indexReady) {
      const sqliteArgs = [path.join(root, 'tools', 'build-sqlite-index.js')];
      if (useIncremental) sqliteArgs.push('--incremental');
      const result = runCommand(process.execPath, sqliteArgs);
      sqliteBuilt = true;
      if (!result.ok) {
        warn('SQLite build failed.');
        recordError('sqlite', result, 'build failed');
        sqliteOk = false;
      }
    } else {
      warn('SQLite build skipped; file-backed indexes missing.');
      sqliteOk = false;
    }
  }
}
recordStep('sqlite', {
  skipped: argv['skip-sqlite'] === true,
  built: sqliteBuilt,
  ok: sqliteOk
});

recordStep('index', {
  skipped: argv['skip-index'] === true,
  restored: restoredArtifacts,
  ready: indexReady,
  built: indexBuilt,
  ok: indexBuildOk
});

if (rl) rl.close();

log('Setup complete.');
log('Tip: run npm run index-validate to verify index artifacts.');
if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
}
