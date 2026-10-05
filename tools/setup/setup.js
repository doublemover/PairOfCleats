#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import readline from 'node:readline/promises';
import { readJsoncFile } from '../../src/shared/jsonc.js';
import { createStdoutGuard } from '../../src/shared/cli/stdout-guard.js';
import { hasChunkMetaArtifactsSync } from '../../src/shared/artifact-io/chunk-meta-presence.js';
import {
  getDictionaryPaths,
  getDictConfig,
  getIndexDir,
  getModelConfig,
  getRepoCacheRoot,
  getRuntimeConfig,
  getToolingConfig,
  loadUserConfig,
  resolveRepoRootArg,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../shared/dict-utils.js';
import { exitLikeCommandResult, runCommand as runCommandBase } from '../shared/cli-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../sqlite/vector-extension.js';
import { verifyVectorExtensionArtifact } from '../sqlite/extension-trust.js';
import { buildSetupReadiness } from './readiness.js';
import { resolveDictionarySetupReadiness } from './dictionary-readiness.js';

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
    'require-steps': { type: 'string' }
  },
  aliases: { ci: 'non-interactive', s: 'with-sqlite', i: 'incremental' }
}).parse();

const explicitRoot = argv.root || argv.repo;
const root = resolveRepoRootArg(explicitRoot);
const toolRoot = resolveToolRoot();
const jsonOutput = argv.json === true;
const nonInteractive = argv['non-interactive'] === true;
const rl = nonInteractive ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
const stdoutGuard = createStdoutGuard({ enabled: jsonOutput, stream: process.stdout, label: 'setup stdout' });

const log = (msg) => {
  const line = `[setup] ${msg}`;
  if (jsonOutput) console.error(line);
  else console.error(line);
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
const requiredSteps = String(argv['require-steps'] || '').split(',').map((id) => id.trim()).filter(Boolean);
const knownSteps = new Set(['config', 'install', 'dictionaries', 'models', 'extensions', 'tooling', 'artifacts', 'index', 'sqlite']);
if (requiredSteps.some((id) => !knownSteps.has(id))) throw new Error('Unknown setup step in --require-steps.');

function finishSetup() {
  summary.readiness = buildSetupReadiness(summary, { requiredIds: requiredSteps });
  if (summary.readiness.state === 'ready') log('Setup complete.');
  else if (summary.readiness.state === 'blocked') warn(`Setup blocked: ${summary.readiness.blockedIds.join(', ')}.`);
  else warn(`Setup finished with limited readiness: ${summary.readiness.omittedIds.join(', ')}.`);
  if (jsonOutput) stdoutGuard.writeJson(summary);
  process.exitCode = summary.readiness.exitCode;
}

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

let runtimeEnv = resolveRuntimeEnv(null, process.env);

/**
 * Execute a setup subprocess with merged runtime environment defaults.
 *
 * In `--json` mode child stdout is suppressed and stderr is inherited so setup
 * can emit a single final JSON summary on stdout without interleaved child
 * output while still surfacing progress/errors.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 * @returns {{ok:boolean,status:number|null,stdout?:string,stderr?:string}}
 */
function runCommand(cmd, args, options = {}) {
  const spawnOptions = {
    cwd: root,
    ...options,
    env: { ...runtimeEnv, ...(options.env || {}) }
  };
  if (!('stdio' in spawnOptions)) {
    spawnOptions.stdio = jsonOutput ? ['ignore', 'ignore', 'inherit'] : 'inherit';
  }
  if (jsonOutput && !('encoding' in spawnOptions)) {
    spawnOptions.encoding = 'utf8';
  }
  return runCommandBase(cmd, args, spawnOptions);
}

/**
 * Run a setup step and terminate immediately when it fails.
 *
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 * @returns {{ok:boolean,status:number|null,stdout?:string,stderr?:string}}
 */
function runOrExit(label, cmd, args, options = {}) {
  const result = runCommand(cmd, args, options);
  if (!result.ok) {
    recordError(label, result, 'command failed');
    console.error(`[setup] Failed: ${label}`);
    finishSetup();
    exitLikeCommandResult(result);
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
  const args = [path.join(toolRoot, 'tools', 'config', 'validate.js'), '--config', configPath];
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
      finishSetup();
      exitLikeCommandResult(result);
    }
  }
} else {
  recordStep('config', { skipped: true, present: configExists, configPath });
}

let userConfig = loadUserConfig(root);
runtimeEnv = resolveRuntimeEnv(getRuntimeConfig(root, userConfig), runtimeEnv);
const repoCacheRoot = getRepoCacheRoot(root, userConfig);
const incrementalCacheRoot = path.join(repoCacheRoot, 'incremental');
const useIncremental = argv.incremental || fs.existsSync(incrementalCacheRoot);
summary.incremental = useIncremental;
if (useIncremental) log('Incremental indexing enabled.');

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
    recordStep('install', { skipped: false, present: false, installed: false, declined: true });
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
  const before = resolveDictionarySetupReadiness({ dictConfig, dictionaryPaths });
  let downloaded = false;
  let declined = false;
  if (before.downloadableLanguages.length) {
    const shouldDownload = await promptYesNo('Download English dictionary wordlist?', true);
    if (shouldDownload) {
      const result = runCommand(process.execPath, [path.join(toolRoot, 'tools', 'download', 'dicts.js'),
        '--lang', before.downloadableLanguages.join(','), '--repo', root, '--dir', dictConfig.dir,
        ...(before.replaceEmptyEnglish ? ['--force'] : [])]);
      if (!result.ok) {
        warn('Dictionary download failed.');
        recordError('dictionaries', result, 'download failed');
      } else {
        downloaded = true;
      }
    } else {
      warn('Skipping dictionary download. Identifier splitting will be limited.');
      declined = true;
    }
  } else if (before.present) {
    log(`Dictionary files found (${dictionaryPaths.length}).`);
  } else if (before.applicable) {
    warn(before.reason);
  }
  const verification = resolveDictionarySetupReadiness({ dictConfig,
    dictionaryPaths: await getDictionaryPaths(root, dictConfig) });
  recordStep('dictionaries', {
    skipped: false,
    applicable: verification.applicable,
    present: verification.present,
    verificationLevel: verification.verificationLevel,
    reason: verification.reason,
    usablePaths: verification.usablePaths,
    beforePresent: before.present,
    downloaded,
    declined
  });
}

if (argv['skip-models']) {
  recordStep('models', { skipped: true });
} else {
  const modelConfig = getModelConfig(root, userConfig);
  const modelDir = modelConfig.dir;
  const hasModels = await hasEntries(modelDir);
  let downloaded = false;
  let declined = false;
  if (!hasModels) {
    const shouldDownload = await promptYesNo(`Download embedding model ${modelConfig.id}?`, true);
    if (shouldDownload) {
      const result = runCommand(process.execPath, [
        path.join(toolRoot, 'tools', 'download', 'models.js'),
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
      declined = true;
    }
  } else {
    log(`Model cache present (${modelDir}).`);
  }
  recordStep('models', { skipped: false, present: await hasEntries(modelDir), beforePresent: hasModels, downloaded, declined });
}

if (argv['skip-extensions']) {
  recordStep('extensions', { skipped: true });
} else {
  const vectorExtension = getVectorExtensionConfig(root, userConfig);
  if (vectorExtension.enabled) {
    const extPath = resolveVectorExtensionPath(vectorExtension);
    const hasExtension = !!(extPath && fs.existsSync(extPath));
    let downloaded = false;
    let declined = false;
    if (!hasExtension) {
      const shouldDownload = await promptYesNo('Download SQLite ANN extension?', true);
      if (shouldDownload) {
        const result = runCommand(process.execPath, [path.join(toolRoot, 'tools', 'download', 'extensions.js'), '--repo', root]);
        if (!result.ok) {
          warn('Extension download failed.');
          recordError('extensions', result, 'download failed');
        } else {
          downloaded = true;
        }
      } else {
        warn('Skipping extension download. ANN acceleration will be unavailable.');
        declined = true;
      }
    } else {
      log(`SQLite ANN extension present (${extPath}).`);
    }
    const verification = verifyVectorExtensionArtifact(resolveVectorExtensionPath(vectorExtension), vectorExtension);
    if (!verification.ok) warn(`SQLite ANN extension is unavailable: ${verification.reason}`);
    recordStep('extensions', {
      skipped: false,
      enabled: true,
      present: verification.present,
      ok: declined ? undefined : verification.ok,
      ready: verification.ok,
      reason: verification.reason,
      verificationLevel: verification.verificationLevel || null,
      verification,
      beforePresent: hasExtension,
      downloaded,
      declined
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
  let toolingDetected = false;
  let toolingReadiness = null;
  let toolingDeclined = false;
  const detectResult = runCommand(
    process.execPath,
    [path.join(toolRoot, 'tools', 'tooling', 'detect.js'), '--root', root, '--json'],
    { encoding: 'utf8', stdio: 'pipe' }
  );
  if (typeof detectResult.signal === 'string' && detectResult.signal.trim()) {
    exitLikeCommandResult(detectResult);
  }
  if (detectResult.status === 0 && detectResult.stdout) {
    try {
      const report = JSON.parse(detectResult.stdout);
      if (!Array.isArray(report.tools)) throw new Error('Tooling detection report has no tool results.');
      toolingDetected = true;
      toolingMissing = report.tools.filter((tool) => tool && tool.found === false);
      if (!toolingMissing.length) {
        log('Optional tooling already installed.');
      } else {
        log(`Missing tooling detected: ${toolingMissing.map((tool) => tool.id).join(', ')}`);
        const shouldInstall = await promptYesNo('Install missing tooling now?', true);
        if (shouldInstall) {
          const scopeDefault = argv['tooling-scope'] || toolingConfig.installScope || 'cache';
          const scope = await promptChoice('Install tooling scope', ['cache', 'global'], scopeDefault);
          const installArgs = [path.join(toolRoot, 'tools', 'tooling', 'install.js'), '--root', root, '--scope', scope, '--json'];
          if (!toolingConfig.allowGlobalFallback) installArgs.push('--no-fallback');
          const result = runCommand(process.execPath, installArgs, { encoding: 'utf8', stdio: 'pipe' });
          let installedReport;
          try { installedReport = JSON.parse(result.stdout || '{}'); }
          catch {
            warn('Failed to parse tooling installation output.');
            recordError('tooling', result, 'install result parse failed');
            installedReport = {};
          }
          toolingReadiness = installedReport.readiness || null;
          if (Array.isArray(installedReport.results)) {
            toolingMissing = installedReport.results.filter((tool) => (
              !['installed', 'already-installed'].includes(tool.status)
            ));
          }
          if (!result.ok) {
            warn('Tooling install failed.');
            recordError('tooling', result, 'install failed');
          } else {
            toolingInstalled = toolingReadiness?.ready === true;
            if (!toolingInstalled) recordError('tooling', result, 'post-install readiness receipt missing or incomplete');
          }
        } else {
          warn('Skipping tooling install.');
          toolingDeclined = true;
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
    installed: toolingInstalled,
    present: toolingDetected && !toolingMissing.length,
    declined: toolingDeclined,
    readiness: toolingReadiness
  });
}

let restoredArtifacts = false;
const artifactsAvailable = fs.existsSync(path.join(root, 'ci-artifacts', 'manifest.json'));
if (!argv['skip-artifacts']) {
  const artifactsDir = path.join(root, 'ci-artifacts');
  const manifestPath = path.join(artifactsDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const shouldRestore = await promptYesNo('Restore CI artifacts from ci-artifacts?', true);
    if (shouldRestore) {
      const result = runCommand(process.execPath, [path.join(toolRoot, 'tools', 'ci', 'restore-artifacts.js'), '--from', artifactsDir]);
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
  applicable: artifactsAvailable,
  restored: restoredArtifacts
});

const codeIndexDir = getIndexDir(root, 'code', userConfig);
const proseIndexDir = getIndexDir(root, 'prose', userConfig);
/**
 * Coarse index artifact readiness probe used by setup prompts.
 *
 * @param {string|null|undefined} indexDir
 * @returns {boolean}
 */
const hasChunkMeta = (indexDir) => {
  if (!indexDir) return false;
  return hasChunkMetaArtifactsSync(indexDir);
};
const codeIndexPresent = hasChunkMeta(codeIndexDir);
const proseIndexPresent = hasChunkMeta(proseIndexDir);
let indexReady = restoredArtifacts || codeIndexPresent || proseIndexPresent;
let indexBuilt = false;
let indexBuildOk = true;

if (!argv['skip-index'] && !restoredArtifacts) {
  const shouldBuild = await promptYesNo(
    indexReady ? 'Index artifacts already exist. Rebuild now?' : 'Build index now?',
    !indexReady
  );
  if (shouldBuild) {
    const args = [path.join(toolRoot, 'build_index.js')];
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
let sqliteRequested = false;
if (!argv['skip-sqlite']) {
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const sqliteDefault = argv['with-sqlite'] ? true : sqliteConfigured;
  const shouldBuildSqlite = argv['with-sqlite']
    ? true
    : await promptYesNo('Build SQLite indexes now?', sqliteDefault);
  if (shouldBuildSqlite) {
    sqliteRequested = true;
    if (!indexReady) {
      const shouldBuildIndex = await promptYesNo('SQLite build requires file-backed indexes. Build index now?', true);
      if (shouldBuildIndex && !argv['skip-index']) {
        const args = [path.join(toolRoot, 'build_index.js')];
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
      const sqliteArgs = [path.join(toolRoot, 'build_index.js'), '--stage', '4'];
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
  applicable: sqliteRequested,
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

finishSetup();
log('Tip: run pairofcleats index validate to verify index artifacts.');
