#!/usr/bin/env node
import { createCli } from '../src/shared/cli.js';
import { buildActions } from './script-coverage/actions.js';
import { loadPackageScripts, resolveScriptCoveragePaths } from './script-coverage/paths.js';
import { applyActionCoverage, applyDefaultSkips, createCoverageState, finalizeCoverage, reportCoverage } from './script-coverage/report.js';
import { createCommandRunner, prepareCoverageDirs, resolveRetries, runShellScripts } from './script-coverage/runner.js';

const root = process.cwd();
const argv = createCli({
  scriptName: 'script-coverage',
  options: {
    retries: { type: 'number', default: 2 },
    'log-dir': { type: 'string', default: '' }
  }
}).parse();
const envRetries = Number.parseInt(
  process.env.PAIROFCLEATS_TEST_RETRIES ?? process.env.npm_config_test_retries ?? '',
  10
);
const retries = resolveRetries({ argvRetries: argv.retries, envRetries, defaultRetries: 2 });
const logDirOverride = argv['log-dir']
  || process.env.PAIROFCLEATS_TEST_LOG_DIR
  || process.env.npm_config_test_log_dir
  || '';

const {
  baseCacheRoot,
  repoCacheRoot,
  fixtureRoot,
  failureLogRoot,
  ciOutDir,
  mergeDir
} = resolveScriptCoveragePaths({ root, logDirOverride });

const scripts = loadPackageScripts(root);
const scriptNames = Object.keys(scripts);
const coverageState = createCoverageState({ scriptNames });

const repoEnv = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: repoCacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

await prepareCoverageDirs({ baseCacheRoot, repoCacheRoot, failureLogRoot });
const { run, runNode } = createCommandRunner({ retries, failureLogRoot });

const actions = await buildActions({
  root,
  fixtureRoot,
  repoEnv,
  baseCacheRoot,
  ciOutDir,
  mergeDir,
  runNode
});

for (const action of actions) {
  console.log(`[script-coverage] ${action.label}`);
  action.run();
  applyActionCoverage(coverageState, action);
}

await runShellScripts({ root, baseCacheRoot, run });

applyDefaultSkips(coverageState);
const summary = finalizeCoverage(coverageState);
const ok = reportCoverage(summary);
if (!ok) process.exit(1);
