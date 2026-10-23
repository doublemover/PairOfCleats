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
import { inspectStorageCategory } from './category-inventory.js';
import { planStorageProbePolicy, applyStorageProbePolicy } from '../../src/shared/storage/probe-policy.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { validateStorageWorkflowIntent, sameStorageWorkflowPath, assertStorageReviewedRepoContext,
  assertStorageCleanupScope, assertStorageMigrationScope } from './workflow-intent.js';
import { resolveStorageDiagnosticScope, diagnoseStorageCategory } from './diagnostics.js';

export const runStorageCli = async (rawArgs = process.argv.slice(2), { signal = null } = {}) => {
  const argv = createCli({ argv: ['node', 'storage', ...rawArgs], scriptName: 'pairofcleats storage', options: STORAGE_OPTIONS,
    usage: `usage: pairofcleats storage <${STORAGE_ACTIONS.join('|')}> [--json]` })
    .strictOptions().check(parsed => {
      if (parsed._.length > 1 || (parsed._.length && !STORAGE_ACTIONS.includes(String(parsed._[0])))) {
        throw new Error('Storage requires at most one supported action.');
      }
      return true;
    }).exitProcess(false).fail(message => { throw new Error(message); }).parse();
  if (argv.help || argv.version) return null;
  const readPlan = async file => {
    signal?.throwIfAborted();
    if (!file) throw new Error('This storage action requires --plan.');
    const target = path.resolve(file);
    return JSON.parse((await readVerifiedContainedFile(path.parse(target).root, target, { maxBytes: 32 * 1024 * 1024, signal })).buffer.toString('utf8'));
  };

  let action = String(argv._[0] || 'list'), mutationStarted = false;
  try {
    action = validateStorageWorkflowIntent(argv, rawArgs);
    signal?.throwIfAborted();
    let repoRoot = path.resolve(argv.repo || process.cwd());
    let userConfig = {};
    const configurationErrors = [];
    try { ({ repoRoot, userConfig } = resolveRepoConfig(argv.repo)); }
    catch (error) { configurationErrors.push({ source: 'repository-config', path: repoRoot,
      ...describeStorageFailure(error, { phase: 'storage-cli-repository-config', defaultCode: 'ERR_STORAGE_REPO_CONFIG' }), authorityGranted: false }); }
    let configPath = null;
    let machineConfig = null;
    try {
      configPath = argv['machine-config'] ? resolveTrustedConfigPath(repoRoot, {
        ...process.env, PAIROFCLEATS_TRUSTED_CONFIG: path.resolve(argv['machine-config']) }) : null;
      machineConfig = configPath ? await readPlan(configPath) : null;
    } catch (error) { configurationErrors.push({ source: 'machine-config', path: argv['machine-config'] || null,
      ...describeStorageFailure(error, { phase: 'storage-cli-machine-config', defaultCode: 'ERR_STORAGE_MACHINE_CONFIG' }), authorityGranted: false });
    configPath = null; machineConfig = null; }
    const layoutInput = { home: argv.home || null, machineConfig, machineConfigPath: configPath,
      overrides: argv['cache-root'] ? { cache: argv['cache-root'] } : {} };
    let layout;
    try { layout = resolveStorageLayout(layoutInput); }
    catch (error) {
      configurationErrors.push({ source: 'machine-storage-layout', path: configPath,
        ...describeStorageFailure(error, { phase: 'storage-cli-layout', defaultCode: 'ERR_STORAGE_LAYOUT' }), authorityGranted: false });
      layout = resolveStorageLayout({ ...layoutInput, machineConfig: null, machineConfigPath: null });
    }
    let storageLocator = null;
    try { storageLocator = readStorageLocator(layout.home.path); layout = applyStorageLocatorSelections(layout, storageLocator); }
    catch (error) { configurationErrors.push({ source: 'active-storage-locator',
      ...describeStorageFailure(error, { phase: 'storage-cli-locator', defaultCode: 'ERR_STORAGE_LOCATOR' }), authorityGranted: false }); }
    const cacheRoot = layout.descriptors.cache.path;
    let legacy = [];
    let currentCache;
    try {
      const explicitLocator = storageLocator || readStorageLocator(layout.home.path);
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
      ...describeStorageFailure(error, { phase: 'storage-cli-current-locations', defaultCode: 'ERR_STORAGE_CURRENT_LOCATIONS' }), authorityGranted: false }); }
    const limits = { maxEntries: argv['max-entries'], maxDurationMs: argv['max-duration-ms'], signal };
    const configurationSelection = category => {
      const environment = getEnvConfig();
      const currentSource = {
        cache: argv['cache-root'] ? 'launch.cache' : userConfig.cache?.root ? 'effective-config.cache.root'
          : environment.cacheRoot ? 'env.PAIROFCLEATS_CACHE_ROOT' : null,
        models: environment.modelsDir ? 'env.PAIROFCLEATS_MODELS_DIR' : userConfig.models?.dir ? 'effective-config.models.dir' : null,
        tooling: environment.toolingDir ? 'env.PAIROFCLEATS_TOOLING_DIR' : userConfig.tooling?.dir ? 'effective-config.tooling.dir' : null,
        extensions: environment.extensionsDir ? 'env.PAIROFCLEATS_EXTENSIONS_DIR' : userConfig.extensions?.dir ? 'effective-config.extensions.dir'
          : userConfig.sqlite?.vectorExtension?.dir ? 'effective-config.sqlite.vectorExtension.dir' : null,
        dictionaries: environment.dictDir ? 'env.PAIROFCLEATS_DICT_DIR' : userConfig.dictionary?.dir ? 'effective-config.dictionary.dir' : null
      }[category];
      const compatibilityId = { models: 'legacy-models', tooling: 'legacy-tooling', extensions: 'legacy-extensions',
        dictionaries: 'legacy-dictionaries', tmp: 'legacy-scratch' }[category];
      const currentPath = category === 'cache' ? currentCache
        : category === 'tmp' && layout.descriptors.tmp.source === 'locator.categories.tmp' ? layout.descriptors.tmp.path
          : legacy.find(entry => entry.id === compatibilityId)?.path;
      return { currentPath: currentPath || layout.descriptors[category]?.path,
        currentSource: currentSource || layout.descriptors[category]?.source };
    };
    let receipt;
    signal?.throwIfAborted();
    const diagnosticScope = ['list', 'explain', 'inspect', 'doctor'].includes(action)
      ? resolveStorageDiagnosticScope({ action, argv, layout, legacy, currentCache }) : null;
    if (configurationErrors.length && ['cleanup-plan', 'cleanup-apply', 'migration-plan', 'migration-apply', 'migration-rollback', 'migration-status', 'configure-plan', 'configure-apply', 'policy-plan', 'policy-apply'].includes(action)) {
      receipt = { schemaVersion: 1, action, ready: false, complete: false, mutationPerformed: false,
        blocked: [{ reason: 'configuration-incomplete-no-storage-authority-granted' }], configurationErrors };
      process.exitCode = 1;
    } else if (action === 'list' || action === 'explain') {
      receipt = { ...explainStorageLayout(diagnosticScope.layout), currentCompatibilityLocations: diagnosticScope.extraRoots,
        inspectionScope: diagnosticScope.inspectionScope };
      if (argv.category) receipt.classes = receipt.classes.filter(entry => entry.category === argv.category);
    }
    else if (['inspect', 'doctor'].includes(action) && diagnosticScope.adapter) {
      const inspect = action === 'doctor' ? diagnoseStorageCategory : inspectStorageCategory;
      receipt = await inspect({ category: argv.category, root: diagnosticScope.root, home: layout.home.path,
        registeredRoots: [...Object.values(layout.descriptors).map(descriptor => descriptor.path), ...legacy.map(entry => entry.path)],
        request: argv.plan ? await readPlan(argv.plan) : null, ...limits });
      receipt = { ...receipt, inspectionScope: diagnosticScope.inspectionScope };
    } else if (action === 'inspect') receipt = { ...await inspectStorageLayout(diagnosticScope.layout, { ...limits, exact: argv.exact,
      extraRoots: diagnosticScope.extraRoots, category: argv.category || null }), inspectionScope: diagnosticScope.inspectionScope };
    else if (action === 'doctor') receipt = { ...await diagnoseStorageLayout(diagnosticScope.layout, { ...limits, extraRoots: diagnosticScope.extraRoots }),
      inspectionScope: diagnosticScope.inspectionScope };
    else if (action === 'policy-plan') {
      const patch = {};
      // An omitted yargs boolean must preserve the current policy, rather than
      // manufacturing an explicit false from parser defaults.
      if (rawArgs.some(token => token === '--enabled' || token === '--no-enabled' || token.startsWith('--enabled='))) patch.enabled = argv.enabled;
      for (const [flag, field] of [['entry-limit', 'entryLimit'], ['hard-bytes', 'hardBytes'], ['max-age-ms', 'maxAgeMs']]) {
        if (argv[flag] !== undefined) patch[field] = argv[flag];
      }
      receipt = await planStorageProbePolicy({ home: layout.home.path, category: argv.category, patch, repoRoot });
    } else if (action === 'policy-apply') {
      const plan = await readPlan(argv.plan);
      assertStorageReviewedRepoContext(plan, repoRoot);
      signal?.throwIfAborted(); mutationStarted = true;
      receipt = await applyStorageProbePolicy(plan, {
        approvedPlanId: argv['plan-id'], home: layout.home.path, category: argv.category, repoRoot
      });
    }
    else if (action === 'configure-plan') {
      receipt = await planStorageConfiguration({ layout, category: argv.category, ...configurationSelection(argv.category),
        target: argv.path, machineConfigPath: configPath, repoRoot });
    } else if (action === 'configure-apply') {
      const plan = await readPlan(argv.plan);
      assertStorageReviewedRepoContext(plan, repoRoot);
      const selection = configurationSelection(argv.category);
      if (!sameStorageWorkflowPath(selection.currentPath, plan.before) || selection.currentSource !== plan.selectedSourceBefore
      || (plan.configurationSource?.path || null) !== configPath) throw new Error('Storage configuration launch sources changed after review; generate a fresh plan.');
      signal?.throwIfAborted(); mutationStarted = true;
      receipt = await applyStorageConfiguration(plan, {
        approvedPlanId: argv['plan-id'], home: layout.home.path, category: argv.category, target: argv.path
      });
    }
    else if (action === 'cleanup-plan') {
      assertStorageCleanupScope({ argv, cacheRoot, currentCache });
      receipt = await planCacheRootCleanup({ cacheRoot, authorityRoots: [cacheRoot], ...limits });
    }
    else if (action === 'cleanup-apply') {
      assertStorageCleanupScope({ argv, cacheRoot, currentCache });
      const plan = await readPlan(argv.plan);
      if (!sameStorageWorkflowPath(plan.cacheRoot, cacheRoot)) throw new Error('Cleanup plan root differs from the launch-selected cache root.');
      signal?.throwIfAborted(); mutationStarted = true;
      receipt = await applyStorageCleanupPlan(plan, { authorityRoots: [cacheRoot], approvedPlanId: argv['plan-id'], signal });
    } else if (action === 'migration-plan') {
      assertStorageMigrationScope({ argv, layout, repoRoot });
      const owner = argv.category === 'dictionaries' ? createDictionaryMigrationOwner({ home: layout.home.path, source: argv.source }) : null;
      receipt = await createStorageMigrationPlan({ category: argv.category,
        source: argv.source, destination: argv.destination, home: layout.home.path,
        recoveryRoot: layout.descriptors.recovery.path, coordinationRoot: path.join(layout.home.path, 'state', 'storage-access'),
        authorityRoots: [layout.home.path], owner, ...limits });
    } else if (action === 'migration-apply' || action === 'migration-rollback') {
      const plan = await readPlan(argv.plan);
      assertStorageMigrationScope({ argv, layout, repoRoot, plan });
      if (plan.category !== 'dictionaries') throw new Error('Dictionary migration requires its existing qualified category owner.');
      const owner = createDictionaryMigrationOwner({ home: layout.home.path, source: plan.source });
      const options = { approvedPlanId: argv['plan-id'], authorityRoots: [layout.home.path], owner,
        checkFreeSpace: input => inspectStorageFreeSpace(input), signal };
      signal?.throwIfAborted(); mutationStarted = true;
      receipt = action === 'migration-apply' ? await applyStorageMigration(plan, options) : await applyStorageMigrationRollback(plan, options);
    } else if (action === 'migration-status') {
      const plan = await readPlan(argv.plan);
      assertStorageMigrationScope({ argv, layout, repoRoot, plan, requireSelectors: false });
      receipt = await readStorageMigrationStatus(plan, { authorityRoots: [layout.home.path] });
    }
    // Reviewed plan bytes are a sealed authority input. Appending even an empty
    // diagnostic field after computing planId would make saved CLI JSON fail
    // exact apply admission. Configuration failures already block plan creation.
    if (!receipt.planId) receipt = { ...receipt, configurationErrors };
    if (argv.json) console.log(JSON.stringify(receipt, null, 2));
    else console.log(JSON.stringify({ action, status: receipt.complete === true ? 'complete' : receipt.ready === false ? 'blocked' : 'review-receipt',
      mutationPerformed: receipt.mutationPerformed ?? (mutationStarted ? null : false), receipt }, null, 2));
    if (['cleanup-apply', 'configure-apply', 'migration-apply', 'migration-rollback', 'policy-apply'].includes(action) && receipt.complete !== true
    || action.endsWith('-plan') && (receipt.ready === false || receipt.applyReady === false)) process.exitCode = 1;
    return receipt;
  } catch (error) {
    let failure;
    try { failure = describeStorageFailure(error, { phase: 'storage-cli-workflow', defaultCode: 'ERR_STORAGE_WORKFLOW' }); }
    catch (pending) { throw addStorageFailureContext(pending, { storageCliContext: Object.freeze({ action, mutationStarted, json: argv.json }) }, undefined,
      { nonEnumerable: ['storageCliContext'] }); }
    const receipt = { schemaVersion: 1, action, state: signal?.aborted ? 'cancelled' : mutationStarted ? 'failed' : 'blocked',
      ready: false, complete: false, mutationPerformed: mutationStarted ? null : false, error: failure };
    if (argv.json) console.log(JSON.stringify(receipt, null, 2));
    else console.error(failure.message);
    process.exitCode = 1;
    return receipt;
  }
};

if (isDirectExecution(import.meta.url)) {
  const controller = new AbortController();
  let cancellationExitCode = null;
  const interrupt = () => { cancellationExitCode = 130; controller.abort(); };
  const terminate = () => { cancellationExitCode = 143; controller.abort(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try { await runStorageCli(process.argv.slice(2), { signal: controller.signal }); }
  catch (error) {
    try { console.error(describeStorageFailure(error, { phase: 'storage-cli-entry' }).message); }
    catch {
      const context = Object.getOwnPropertyDescriptor(error, 'storageCliContext')?.value;
      const receipt = { schemaVersion: 1, action: context?.action || null, state: 'settlement-pending', complete: false,
        mutationPerformed: context?.mutationStarted === false ? false : null,
        nextAction: 'Retain the reviewed plan and recovery evidence. The actual resource owner must settle before retry.' };
      if (context?.json) console.log(JSON.stringify(receipt, null, 2));
      else console.error(receipt.nextAction);
    }
    process.exitCode ||= 1;
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    if (cancellationExitCode) process.exitCode = cancellationExitCode;
  }
}
