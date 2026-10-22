#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveStorageLayout } from '../../src/shared/storage/layout.js';
import { resolveLegacyStorageLocations } from '../../src/shared/storage/catalog.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { resolveTrustedConfigPath } from '../../src/shared/config-authority.js';
import { explainStorageLayout, inspectStorageLayout, diagnoseStorageLayout, planStorageConfiguration } from '../../src/shared/storage/operator.js';
import { planCacheRootCleanup, applyStorageCleanupPlan } from '../../src/shared/storage/cleanup.js';
import { createStorageMigrationPlan } from '../../src/shared/storage/migration-plan.js';
import { readStorageMigrationStatus } from '../../src/shared/storage/migration.js';
import { resolveRepoConfig, resolveRepoCacheRootPath, getModelsDir, getToolingDir, getExtensionsDir, getDictConfig, getCacheRoot } from '../shared/dict-utils.js';
import { getApplicationHome } from '../../src/shared/cache-roots.js';
import { STORAGE_ACTIONS, STORAGE_OPTIONS } from './options.js';

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
  const layout = resolveStorageLayout({ home: argv.home || null, machineConfig, machineConfigPath: configPath,
    overrides: argv['cache-root'] ? { cache: argv['cache-root'] } : {} });
  const cacheRoot = layout.descriptors.cache.path;
  let legacy = [];
  try {
    const currentCache = userConfig.cache?.root || getCacheRoot();
    legacy = resolveLegacyStorageLocations({ home: getApplicationHome(), cacheRoot: currentCache,
      repoRoots: [resolveRepoCacheRootPath(repoRoot, userConfig)], modelsRoot: getModelsDir(repoRoot, userConfig),
      toolingRoot: getToolingDir(repoRoot, userConfig), extensionsRoot: getExtensionsDir(repoRoot, userConfig),
      dictionariesRoot: getDictConfig(repoRoot, userConfig).dir });
  } catch (error) { configurationErrors.push({ source: 'current-storage-locator',
    code: error.code || 'ERR_STORAGE_CURRENT_LOCATIONS', message: error.message, authorityGranted: false }); }
  const limits = { maxEntries: argv['max-entries'], maxDurationMs: argv['max-duration-ms'] };
  let receipt;
  if (configurationErrors.length && ['cleanup-plan', 'cleanup-apply', 'migration-plan', 'migration-status', 'configure-plan'].includes(action)) {
    receipt = { schemaVersion: 1, action, ready: false, complete: false, mutationPerformed: false,
      blocked: [{ reason: 'configuration-incomplete-no-storage-authority-granted' }], configurationErrors };
    process.exitCode = 1;
  } else if (action === 'list' || action === 'explain') receipt = { ...explainStorageLayout(layout), currentCompatibilityLocations: legacy };
  else if (action === 'inspect') receipt = await inspectStorageLayout(layout, { ...limits, exact: argv.exact, extraRoots: legacy });
  else if (action === 'doctor') receipt = await diagnoseStorageLayout(layout, { ...limits, extraRoots: legacy });
  else if (action === 'configure-plan') receipt = planStorageConfiguration({ layout, category: argv.category,
    target: argv.path, machineConfigPath: configPath, repoRoot });
  else if (action === 'cleanup-plan') receipt = await planCacheRootCleanup({ cacheRoot, authorityRoots: [cacheRoot], ...limits });
  else if (action === 'cleanup-apply') {
    const plan = await readPlan(argv.plan);
    if (plan.cacheRoot !== cacheRoot) throw new Error('Cleanup plan root differs from the launch-selected cache root.');
    receipt = await applyStorageCleanupPlan(plan, { authorityRoots: [cacheRoot], approvedPlanId: argv['plan-id'] });
  } else if (action === 'migration-plan') receipt = await createStorageMigrationPlan({ category: argv.category,
    source: argv.source, destination: argv.destination, home: layout.home.path,
    recoveryRoot: layout.descriptors.recovery.path, coordinationRoot: path.join(layout.descriptors.state.path, 'storage-access'),
    authorityRoots: [layout.home.path, cacheRoot], ...limits });
  else if (action === 'migration-status') receipt = await readStorageMigrationStatus(await readPlan(argv.plan), { authorityRoots: [layout.home.path, cacheRoot] });
  receipt = { ...receipt, configurationErrors };
  if (argv.json) console.log(JSON.stringify(receipt, null, 2));
  else console.log(JSON.stringify({ action, status: receipt.complete === true ? 'complete' : receipt.ready === false ? 'blocked' : 'review-receipt',
    mutationPerformed: receipt.mutationPerformed === true, receipt }, null, 2));
  if (action === 'cleanup-apply' && receipt.complete !== true) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
