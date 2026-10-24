#!/usr/bin/env node
// Source and focused regressions are UNVALIDATED in this development batch.
import { BOOTSTRAP_OPTIONS } from '../shared/operator-cli-options.js';
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createStdoutGuard } from '../../src/shared/cli/stdout-guard.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';
import { getDictionaryPaths, getDictConfig, getRepoCacheRoot, getRuntimeConfig, getToolingConfig, resolveRepoConfig, resolveRuntimeEnv, resolveToolRoot } from '../shared/dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from '../sqlite/vector-extension.js';
import { resolveDictionarySetupReadiness } from './dictionary-readiness.js';
import { runSetupCommand } from './owned-command.js';

/** Run selected target preparation through the same actual child owner as
 * guided setup. A pending owner is terminal for this run, including optional
 * tooling and artifact restoration; it must never admit a following build.
 */
export const runBootstrap = async (argv, {
  signal, command = runSetupCommand, log = console.error, writeProgress = chunk => process.stderr.write(chunk)
} = {}) => {
  const summary = { root: path.resolve(argv.repo || process.cwd()), incremental: false, restoredArtifacts: false, steps: {} };
  let activeStep = 'config';
  let baseEnv = process.env;
  let root = summary.root;
  const jsonOutput = argv.json === true;
  const recordStep = (name, data) => { summary.steps[name] = { ...(summary.steps[name] || {}), ...data }; };
  const execute = async (args, { capture = false, env = baseEnv } = {}) => {
    signal?.throwIfAborted();
    const result = await command(process.execPath, args, { cwd: root, env, signal, encoding: 'utf8',
      ...(capture ? { stdio: 'pipe' } : jsonOutput ? {
        stdio: ['inherit', 'pipe', 'pipe'], captureStdout: false, captureStderr: false,
        onStdout: writeProgress, onStderr: writeProgress
      } : { stdio: 'inherit' }) });
    signal?.throwIfAborted();
    return result;
  };
  const requireOk = (result, label) => {
    if (result.ok) return;
    throw Object.assign(new Error(`Failed: ${label}`), { code: 'ERR_BOOTSTRAP_STEP_FAILED', result });
  };
  const run = async (args, label) => { requireOk(await execute(args), label); };
  try {
    signal?.throwIfAborted();
    const resolved = resolveRepoConfig(argv.repo);
    root = resolved.repoRoot;
    summary.root = root;
    const userConfig = resolved.userConfig;
    const toolRoot = resolveToolRoot();
    const configPath = path.join(root, '.pairofcleats.json');
    if (argv['validate-config'] && fs.existsSync(configPath)) {
      await run([path.join(toolRoot, 'tools', 'config', 'validate.js'), '--config', configPath], 'validate config');
    }
    baseEnv = resolveRuntimeEnv(getRuntimeConfig(root, userConfig), process.env);
    const vectorExtension = getVectorExtensionConfig(root, userConfig);
    const useIncremental = argv.incremental || fs.existsSync(path.join(getRepoCacheRoot(root, userConfig), 'incremental'));
    summary.incremental = Boolean(useIncremental);
    if (useIncremental) log('[bootstrap] Incremental indexing enabled.');

    // Target selection never authorizes application or target package scripts.
    recordStep('install', { skipped: true, installed: false, toolRoot, targetRoot: root,
      reason: 'Tool dependencies are prepared separately with npm run bootstrap:ci in the tool checkout.' });

    activeStep = 'dictionaries';
    signal?.throwIfAborted();
    if (!argv['skip-dicts']) {
      const dictConfig = getDictConfig(root, userConfig);
      const before = resolveDictionarySetupReadiness({ dictConfig, dictionaryPaths: await getDictionaryPaths(root, dictConfig) });
      if (before.downloadableLanguages.length) await run([
        path.join(toolRoot, 'tools', 'download', 'dicts.js'), '--repo', root, '--dir', dictConfig.dir,
        '--lang', before.downloadableLanguages.join(','), ...(before.replaceEmptyEnglish ? ['--force'] : [])
      ], 'download selected dictionaries');
      signal?.throwIfAborted();
      const verification = resolveDictionarySetupReadiness({ dictConfig, dictionaryPaths: await getDictionaryPaths(root, dictConfig) });
      recordStep('dictionaries', { skipped: false, ...verification, available: verification.present,
        count: verification.usablePaths.length, status: !verification.applicable ? 'not-applicable' : verification.present ? 'available' : 'missing' });
      if (verification.present) log(`[bootstrap] Wordlists enabled (${verification.usablePaths.length} file(s)).`);
      else if (verification.applicable) log(`[bootstrap] ${verification.reason}`);
    } else recordStep('dictionaries', { skipped: true });

    activeStep = 'extensions';
    signal?.throwIfAborted();
    if (vectorExtension.enabled) {
      const extPath = resolveVectorExtensionPath(vectorExtension);
      const available = Boolean(extPath && fs.existsSync(extPath));
      recordStep('extensions', { skipped: false, available, ...(available ? { path: extPath } : {}) });
      log(available ? `[bootstrap] SQLite ANN extension found (${extPath}).`
        : '[bootstrap] SQLite ANN extension missing; run node tools/download/extensions.js to install.');
    } else recordStep('extensions', { skipped: true, enabled: false });

    activeStep = 'tooling';
    signal?.throwIfAborted();
    if (!argv['skip-tooling']) {
      const toolingConfig = getToolingConfig(root, userConfig);
      const detected = await execute([path.join(toolRoot, 'tools', 'tooling', 'detect.js'), '--root', root, '--json'], { capture: true });
      if (detected.signal) requireOk(detected, 'detect tooling');
      let report = null;
      if (detected.ok && detected.stdout) {
        try { report = JSON.parse(detected.stdout); }
        catch { recordStep('tooling', { skipped: false, detectParsed: false }); }
      }
      if (report) {
        const missingTools = Array.isArray(report.tools) ? report.tools.filter(tool => tool && tool.found === false) : [];
        if (toolingConfig.autoInstallOnDetect && missingTools.length) {
          const installArgs = [path.join(toolRoot, 'tools', 'tooling', 'install.js'), '--root', root,
            '--tools', missingTools.map(tool => tool.id).join(','), '--scope', toolingConfig.installScope];
          if (!toolingConfig.allowGlobalFallback) installArgs.push('--no-fallback');
          // Installation is deliberately outside the JSON parse catch: actual
          // cancellation/pending teardown cannot become a parse warning.
          await run(installArgs, 'install tooling');
          recordStep('tooling', { skipped: false, status: 'installation-completed', requestedTools: missingTools.map(tool => tool.id) });
        } else if (missingTools.length) {
          log('[bootstrap] Optional tooling missing. Run node tools/tooling/install.js to install.');
          recordStep('tooling', { skipped: false, status: 'not-requested', missingTools: missingTools.map(tool => tool.id) });
        } else recordStep('tooling', { skipped: false, status: 'available', missingTools: [] });
      } else if (!detected.ok) {
        log('[bootstrap] Tooling detection failed.');
        recordStep('tooling', { skipped: false, detectOk: false });
      }
    } else recordStep('tooling', { skipped: true });

    activeStep = 'artifacts';
    signal?.throwIfAborted();
    const artifactsDir = path.join(root, 'ci-artifacts');
    if (!argv['skip-artifacts'] && fs.existsSync(path.join(artifactsDir, 'manifest.json'))) {
      summary.restoredArtifacts = (await execute([path.join(toolRoot, 'tools', 'ci', 'restore-artifacts.js'), '--from', artifactsDir, '--repo', root])).ok;
    }
    recordStep('artifacts', { skipped: argv['skip-artifacts'] === true, restored: summary.restoredArtifacts });

    activeStep = 'index';
    signal?.throwIfAborted();
    if (!argv['skip-index'] && !summary.restoredArtifacts) {
      await run([path.join(toolRoot, 'build_index.js'), '--repo', root, ...(useIncremental ? ['--incremental'] : [])], 'build index');
      recordStep('index', { skipped: false, built: true });
    } else recordStep('index', { skipped: argv['skip-index'] === true, built: false });

    activeStep = 'sqlite';
    signal?.throwIfAborted();
    if (argv['with-sqlite']) {
      await run([path.join(toolRoot, 'build_index.js'), '--repo', root, '--stage', '4', ...(useIncremental ? ['--incremental'] : [])], 'build sqlite index');
      recordStep('sqlite', { skipped: false, built: true });
    } else recordStep('sqlite', { skipped: true, built: false });
    signal?.throwIfAborted();
    log('[bootstrap] Tip: run pairofcleats index validate to verify index artifacts.');
    log('Bootstrap complete.');
    return { summary, exitCode: 0 };
  } catch (error) {
    const state = error.cacheOwnershipPending ? 'settlement-pending' : signal?.aborted ? 'cancelled' : 'blocked';
    summary.lifecycle = { state, step: activeStep, code: error.code || null,
      settlement: error.cacheOwnershipPending ? 'actual-child-resource-owner-unconfirmed' : 'no-pending-owner-reported' };
    summary.errors = [{ step: activeStep, status: error.result?.status ?? null, signal: error.result?.signal || null,
      message: redactDiagnosticText(error.message || String(error), 2048) }];
    recordStep(activeStep, { completed: false, state });
    log(`[bootstrap] ${state}: ${summary.errors[0].message}`);
    return { summary, exitCode: error.result?.signal === 'SIGINT' ? 130 : error.result?.signal === 'SIGTERM' ? 143
      : Number.isInteger(error.result?.status) && error.result.status > 0 ? error.result.status : 1 };
  }
};

if (isDirectExecution(import.meta.url)) {
  const argv = createCli({ scriptName: 'bootstrap', options: BOOTSTRAP_OPTIONS,
    aliases: { s: 'with-sqlite', i: 'incremental' } }).strictOptions().parse();
  const cancellation = new AbortController();
  let cancellationExitCode = null;
  const onInterrupt = () => { cancellationExitCode = 130; cancellation.abort(new Error('Bootstrap interrupted.')); };
  const onTerminate = () => { cancellationExitCode = 143; cancellation.abort(new Error('Bootstrap terminated.')); };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    const result = await runBootstrap(argv, { signal: cancellation.signal });
    if (argv.json) createStdoutGuard({ enabled: true, stream: process.stdout, label: 'bootstrap stdout' }).writeJson(result.summary);
    process.exitCode = cancellationExitCode || result.exitCode;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}
