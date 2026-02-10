#!/usr/bin/env node
import { createCli } from '../../../src/shared/cli.js';
import { buildActions, SCRIPT_COVERAGE_GROUPS } from './actions.js';
import { loadPackageScripts, resolveScriptCoveragePaths } from './paths.js';
import { applyActionCoverage, applyDefaultSkips, createCoverageState, finalizeCoverage, reportCoverage } from './report.js';
import { createCommandRunner, prepareCoverageDirs, resolveRetries, runShellScripts } from './runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { repoRoot } from '../../helpers/root.js';

applyTestEnv({ testing: '1' });

const parseCsvSet = (value) => {
  if (!value || typeof value !== 'string') return new Set();
  return new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean));
};

const normalizeShardValue = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const collectCoverageScripts = (actions) => {
  const names = new Set();
  for (const action of actions || []) {
    for (const key of ['covers', 'coversTierB']) {
      const values = Array.isArray(action[key]) ? action[key] : [];
      for (const name of values) {
        if (typeof name === 'string' && name) names.add(name);
      }
    }
  }
  return Array.from(names);
};

const root = repoRoot();
const argv = createCli({
  scriptName: 'script-coverage',
  options: {
    retries: { type: 'number', default: 2 },
    'log-dir': { type: 'string', default: '' },
    groups: { type: 'string', default: '' },
    'list-groups': { type: 'boolean', default: false },
    'shard-count': { type: 'number', default: 0 },
    'shard-index': { type: 'number', default: 0 },
    'cache-root': { type: 'string', default: '' }
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
const baseCacheRootOverride = argv['cache-root']
  || process.env.PAIROFCLEATS_SCRIPT_COVERAGE_CACHE_ROOT
  || '';
const selectedGroups = parseCsvSet(
  argv.groups || process.env.PAIROFCLEATS_SCRIPT_COVERAGE_GROUPS || ''
);
const shardCount = normalizeShardValue(
  argv['shard-count'] || process.env.PAIROFCLEATS_SCRIPT_COVERAGE_SHARD_COUNT,
  0
);
const shardIndex = normalizeShardValue(
  argv['shard-index'] || process.env.PAIROFCLEATS_SCRIPT_COVERAGE_SHARD_INDEX,
  0
);

const {
  baseCacheRoot,
  repoCacheRoot,
  fixtureRoot,
  failureLogRoot,
  ciOutDir,
  mergeDir
} = resolveScriptCoveragePaths({ root, logDirOverride, baseCacheRootOverride });

const scripts = loadPackageScripts(root);
const scriptNames = Object.keys(scripts);

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
  runNode,
  scriptNames: new Set(scriptNames)
});

if (argv['list-groups']) {
  for (const group of SCRIPT_COVERAGE_GROUPS) {
    console.log(group);
  }
  process.exit(0);
}

const knownScripts = new Set(scriptNames);
const unknownCovers = new Set();
for (const action of actions) {
  for (const key of ['covers', 'coversTierB']) {
    const values = Array.isArray(action[key]) ? action[key] : [];
    for (const name of values) {
      if (!knownScripts.has(name)) unknownCovers.add(name);
    }
  }
}
if (unknownCovers.size) {
  console.error(`script coverage references missing scripts: ${Array.from(unknownCovers).sort().join(', ')}`);
  process.exit(1);
}

const availableGroups = new Set(SCRIPT_COVERAGE_GROUPS);
for (const group of selectedGroups) {
  if (!availableGroups.has(group)) {
    console.error(`Unknown script coverage group "${group}". Available: ${Array.from(availableGroups).sort().join(', ')}`);
    process.exit(1);
  }
}

if (shardCount > 0 && (shardIndex < 1 || shardIndex > shardCount)) {
  console.error(`Invalid shard index ${shardIndex} for shard count ${shardCount}.`);
  process.exit(1);
}

let selectedActions = actions;
if (selectedGroups.size) {
  selectedActions = selectedActions.filter((action) => selectedGroups.has(action.group));
}
if (shardCount > 1) {
  const zeroIndex = shardIndex - 1;
  selectedActions = selectedActions.filter((_, idx) => (idx % shardCount) === zeroIndex);
}
if (!selectedActions.length) {
  console.error('No script coverage actions selected.');
  process.exit(1);
}

const shardMode = selectedGroups.size > 0 || shardCount > 1;
const coverageScripts = shardMode ? collectCoverageScripts(selectedActions) : scriptNames;
const coverageState = createCoverageState({
  scriptNames: coverageScripts,
  enforceTierB: !shardMode
});

for (const action of selectedActions) {
  console.log(`[script-coverage] ${action.label}`);
  action.run();
  applyActionCoverage(coverageState, action);
}

if (!shardMode || selectedGroups.has('tools')) {
  await runShellScripts({ root, baseCacheRoot, run });
}

applyDefaultSkips(coverageState);
const summary = finalizeCoverage(coverageState);
const ok = reportCoverage(summary);
if (!ok) process.exit(1);
