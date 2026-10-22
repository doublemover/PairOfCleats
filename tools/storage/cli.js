#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { resolveLegacyStorageLocations } from '../../src/shared/storage/catalog.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { resolveTrustedConfigPath } from '../../src/shared/config-authority.js';
import { explainStorageLayout, inspectStorageLayout, diagnoseStorageLayout, planStorageConfiguration, applyStorageConfiguration } from '../../src/shared/storage/operator.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../src/shared/storage/cleanup.js';
import { createStorageMigrationPlan } from '../../src/shared/storage/migration-plan.js';
import { applyStorageMigration, applyStorageMigrationRollback, readStorageMigrationStatus } from '../../src/shared/storage/migration.js';
import { createDictionaryMigrationOwner } from '../../src/shared/storage/dictionary-adapter.js';
import { inspectStorageFreeSpace } from '../../src/shared/storage/destination.js';
import { resolveRepoConfig, resolveRepoCacheRootPath, getModelsDir, getToolingDir, getExtensionsDir, getDictConfig, getCacheRoot } from '../shared/dict-utils.js';
import { STORAGE_ACTIONS, STORAGE_OPTIONS } from './options.js';
import { readStorageLocator } from '../../src/shared/storage/locator-read.js';
import { getEnvConfig } from '../../src/shared/env.js';
import { applyStorageLocatorSelections } from '../../src/shared/storage/selected-layout.js';
import { inspectStorageCategory, STORAGE_INVENTORY_ADAPTERS } from './category-inventory.js';
import { planStorageProbePolicy, applyStorageProbePolicy } from '../../src/shared/storage/probe-policy.js';

const argv = createCli({ scriptName: 'pairofcleats storage', options: STORAGE_OPTIONS,
  usage: `usage: pairofcleats storage <${STORAGE_ACTIONS.join('|')}> [--json]` })
  .strictOptions().check(parsed => {
    if (parsed._.length > 1 || (parsed._.length && !STORAGE_ACTIONS.includes(String(parsed._[0])))) {
      throw new Error('Storage requires at most one supported action.');
    }
    return true;
  }).parse();
const readPlan = async file => {
  if (!file) throw new Error('This storage action requires --plan.');
  const target = path.resolve(file);
  return JSON.parse((await readVerifiedContainedFile(path.parse(target).root, target, { maxBytes: 32 * 1024 * 1024 })).buffer.toString('utf8'));
};

try {
  const action = String(argv._[0] || 'list');
  if (!STORAGE_ACTIONS.includes(action)) throw new Error(`Unknown storage action: ${action}`);
  let repoRoot = path.resolve(argv.repo || process.cwd());
  let userConfig = {};
  const configurationErrors = [];
  try { ({ repoRoot, userConfig } = resolveRepoConfig(argv.repo)); }
  catch (error) { configurationErrors.push({ source: 'repository-config', path: repoRoot,
    code: error.code || 'ERR_STORAGE_REPO_CONFIG', message: error.message, authorityGranted: false }); }
  let configPath = null;
  let machineConfig = null;
  try {
    configPath = argv['machine-config'] ? resolveTrustedConfigPath(repoRoot, {
      ...process.env, PAIROFCLEATS_TRUSTED_CONFIG: path.resolve(argv['machine-config']) }) : null;
    machineConfig = configPath ? await readPlan(configPath) : null;
  } catch (error) { configurationErrors.push({ source: 'machine-config', path: argv['machine-config'] || null,
    code: error.code || 'ERR_STORAGE_MACHINE_CONFIG', message: error.message, authorityGranted: false });
    configPath = null; machineConfig = null; }
  const layoutInput = { home: argv.home || null, machineConfig, machineConfigPath: configPath,
    overrides: argv['cache-root'] ? { cache: argv['cache-root'] } : {} };
  let layout;
  try { layout = resolveStorageLayout(layoutInput); }
  catch (error) {
    configurationErrors.push({ source: 'machine-storage-layout', path: configPath, code: error.code || 'ERR_STORAGE_LAYOUT',
      message: error.message, authorityGranted: false });
    layout = resolveStorageLayout({ ...layoutInput, machineConfig: null, machineConfigPath: null });
  }
  try { layout = applyStorageLocatorSelections(layout, readStorageLocator(layout.home.path)); }
  catch (error) { configurationErrors.push({ source: 'active-storage-locator', code: error.code || 'ERR_STORAGE_LOCATOR',
    message: error.message, authorityGranted: false }); }
  const cacheRoot = layout.descriptors.cache.path;
  let legacy = [];
  let currentCache;
  try {
    const explicitLocator = readStorageLocator(layout.home.path);
    if (explicitLocator.status === 'invalid') throw new Error(`Storage locator is invalid: ${explicitLocator.target}`);
    const env = getEnvConfig();
    const selected = category => explicitLocator.value.categories[category]?.path;
    currentCache = userConfig.cache?.root || (argv.home ? env.cacheRoot ? cacheRoot
      : selected('cache') || path.join(layout.home.path, 'cache') : getCacheRoot());
    legacy = resolveLegacyStorageLocations({ home: layout.home.path, cacheRoot: currentCache,
      repoRoots: argv.home ? [] : [resolveRepoCacheRootPath(repoRoot, userConfig)],
      modelsRoot: argv.home ? env.modelsDir || userConfig.models?.dir || selected('models') || path.join(currentCache, 'models') : getModelsDir(repoRoot, userConfig),
      toolingRoot: argv.home ? env.toolingDir || userConfig.tooling?.dir || selected('tooling') || path.join(layout.home.path, 'tooling') : getToolingDir(repoRoot, userConfig),
      extensionsRoot: argv.home ? env.extensionsDir || userConfig.extensions?.dir || userConfig.sqlite?.vectorExtension?.dir || selected('extensions') || path.join(layout.home.path, 'extensions') : getExtensionsDir(repoRoot, userConfig),
      dictionariesRoot: argv.home ? env.dictDir || userConfig.dictionary?.dir || selected('dictionaries') || path.join(layout.home.path, 'dictionaries') : getDictConfig(repoRoot, userConfig).dir });
  } catch (error) { configurationErrors.push({ source: 'current-storage-locator',
    code: error.code || 'ERR_STORAGE_CURRENT_LOCATIONS', message: error.message, authorityGranted: false }); }
  const limits = { maxEntries: argv['max-entries'], maxDurationMs: argv['max-duration-ms'] };
  let receipt;
  if (configurationErrors.length && ['cleanup-plan', 'cleanup-apply', 'migration-plan', 'migration-apply', 'migration-rollback', 'migration-status', 'configure-plan', 'configure-apply', 'policy-plan', 'policy-apply'].includes(action)) {
    receipt = { schemaVersion: 1, action, ready: false, complete: false, mutationPerformed: false,
      blocked: [{ reason: 'configuration-incomplete-no-storage-authority-granted' }], configurationErrors };
    process.exitCode = 1;
  } else if (action === 'list' || action === 'explain') receipt = { ...explainStorageLayout(layout), currentCompatibilityLocations: legacy };
  else if (action === 'inspect' && STORAGE_INVENTORY_ADAPTERS.includes(argv.category)) {
    const root = argv.path || (argv.category === 'command-probes' ? path.join(currentCache || cacheRoot, 'tooling', 'command-probes')
      : argv.category === 'dictionaries' ? legacy.find(entry => entry.id === 'legacy-dictionaries')?.path : null);
    receipt = await inspectStorageCategory({ category: argv.category, root, home: layout.home.path,
      request: argv.plan ? await readPlan(argv.plan) : null, ...limits });
  } else if (action === 'inspect') receipt = await inspectStorageLayout(layout, { ...limits, exact: argv.exact,
    extraRoots: legacy, category: argv.category || null });
  else if (action === 'doctor') receipt = await diagnoseStorageLayout(layout, { ...limits, extraRoots: legacy });
  else if (action === 'policy-plan') {
    const patch = {};
    // An omitted yargs boolean must preserve the current policy, rather than
    // manufacturing an explicit false from parser defaults.
    if (process.argv.slice(2).some(token => token === '--enabled' || token === '--no-enabled' || token.startsWith('--enabled='))) patch.enabled = argv.enabled;
    for (const [flag, field] of [['entry-limit', 'entryLimit'], ['hard-bytes', 'hardBytes'], ['max-age-ms', 'maxAgeMs']]) {
      if (argv[flag] !== undefined) patch[field] = argv[flag];
    }
    receipt = await planStorageProbePolicy({ home: layout.home.path, category: argv.category, patch, repoRoot });
  } else if (action === 'policy-apply') receipt = await applyStorageProbePolicy(await readPlan(argv.plan), {
    approvedPlanId: argv['plan-id'], home: layout.home.path, category: argv.category, repoRoot
  });
  else if (action === 'configure-plan') {
    const compatibilityId = { models: 'legacy-models', tooling: 'legacy-tooling', extensions: 'legacy-extensions',
      dictionaries: 'legacy-dictionaries', tmp: 'legacy-scratch' }[argv.category];
    const currentPath = argv.category === 'cache' ? currentCache
      : argv.category === 'tmp' && layout.descriptors.tmp.source === 'locator.categories.tmp' ? layout.descriptors.tmp.path
      : legacy.find(entry => entry.id === compatibilityId)?.path;
    receipt = await planStorageConfiguration({ layout, category: argv.category, currentPath,
      target: argv.path, machineConfigPath: configPath, repoRoot });
  } else if (action === 'configure-apply') receipt = await applyStorageConfiguration(await readPlan(argv.plan), {
    approvedPlanId: argv['plan-id'], home: layout.home.path, category: argv.category, target: argv.path
  });
  else if (action === 'cleanup-plan') receipt = await planCacheRootCleanup({ cacheRoot, authorityRoots: [cacheRoot], ...limits });
  else if (action === 'cleanup-apply') {
    const plan = await readPlan(argv.plan);
    if (plan.cacheRoot !== cacheRoot) throw new Error('Cleanup plan root differs from the launch-selected cache root.');
    receipt = await applyStorageCleanupPlan(plan, { authorityRoots: [cacheRoot], approvedPlanId: argv['plan-id'] });
  } else if (action === 'migration-plan') {
    const owner = argv.category === 'dictionaries' ? createDictionaryMigrationOwner({ home: layout.home.path, source: argv.source }) : null;
    receipt = await createStorageMigrationPlan({ category: argv.category,
      source: argv.source, destination: argv.destination, home: layout.home.path,
      recoveryRoot: layout.descriptors.recovery.path, coordinationRoot: path.join(layout.home.path, 'state', 'storage-access'),
      authorityRoots: [layout.home.path], owner, ...limits });
  } else if (action === 'migration-apply' || action === 'migration-rollback') {
    const plan = await readPlan(argv.plan);
    if (plan.category !== 'dictionaries' || argv.category !== plan.category || !path.isAbsolute(argv.source || '')
      || !path.isAbsolute(argv.destination || '') || path.resolve(argv.source) !== plan.source
      || path.resolve(argv.destination) !== plan.destination || layout.home.path !== plan.home) {
      throw new Error('Dictionary migration requires exact launch-selected category, source, destination and application home.');
    }
    const owner = createDictionaryMigrationOwner({ home: layout.home.path, source: plan.source });
    const options = { approvedPlanId: argv['plan-id'], authorityRoots: [layout.home.path], owner,
      checkFreeSpace: input => inspectStorageFreeSpace(input) };
    receipt = action === 'migration-apply' ? await applyStorageMigration(plan, options) : await applyStorageMigrationRollback(plan, options);
  } else if (action === 'migration-status') receipt = await readStorageMigrationStatus(await readPlan(argv.plan), { authorityRoots: [layout.home.path] });
  // Reviewed plan bytes are a sealed authority input. Appending even an empty
  // diagnostic field after computing planId would make saved CLI JSON fail
  // exact apply admission. Configuration failures already block plan creation.
  if (!receipt.planId) receipt = { ...receipt, configurationErrors };
  if (argv.json) console.log(JSON.stringify(receipt, null, 2));
  else console.log(JSON.stringify({ action, status: receipt.complete === true ? 'complete' : receipt.ready === false ? 'blocked' : 'review-receipt',
    mutationPerformed: receipt.mutationPerformed === true, receipt }, null, 2));
  if (['cleanup-apply', 'configure-apply', 'migration-apply', 'policy-apply'].includes(action) && receipt.complete !== true) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
