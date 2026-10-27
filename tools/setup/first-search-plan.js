import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { modify, applyEdits } from 'jsonc-parser';
import { parseJsoncText } from '../../src/shared/jsonc.js';
import { mergeConfig } from '../../src/shared/config.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import { validateConfig } from '../../src/config/validate.js';
import { loadUserConfig, readShippedConfigSchema } from '../dict-utils/config.js';
import { getModelConfig, getToolingConfig, resolveRepoCacheRootPath, resolveToolRoot } from '../shared/dict-utils.js';
import { buildToolingReport, locateToolExecutable, resolveToolsById, selectInstallPlan } from '../tooling/utils.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { createToolProvisioningPlan } from '../tooling/provisioning-plan.js';
import { resolveModelSetupReadiness } from './model-readiness.js';
import { resolveDeclaredInstallAdmission } from '../tooling/install-execution.js';
import { SETUP_OPTIONS } from '../shared/operator-cli-options.js';
import { admitFirstSearchToolReceipt, describeAppliedFirstSearchCapabilities, describeFirstSearchCapabilities, identifySetupTarget } from './first-search-capabilities.js';
import { resolveWorkspaceChildRuntimeEnv } from '../../src/workspace/child-runtime-env.js';
import { resolveFirstSearchSuggestion } from './first-search-suggestion.js';
import { isResolvedCommandTrusted } from '../../src/shared/config-authority.js';
import { describeStorageFailure, observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { readJsonResourceTextSync } from '../../src/shared/file-read-resource.js';
import { sha256File } from '../../src/shared/hash.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { redactDiagnosticText } from '../../src/shared/diagnostic-text.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const readOptional = file => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Setup config must be a bounded regular file.');
    return readJsonResourceTextSync(file, opened => {
      if (opened.size > 1024 * 1024) throw new Error('Setup config must be a bounded regular file.');
    });
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'first-search-config-read' });
    observation.requireSettled();
    let code;
    try { code = observation.primary.code; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    if (code === 'ENOENT') return null;
    throw error;
  }
};

export const createFirstSearchPlan = async ({ repoRoot, profile = 'sparse', model = null, backend = 'memory', tools = [], signal = null } = {}) => {
  signal?.throwIfAborted();
  const targetIdentity = identifySetupTarget(repoRoot);
  repoRoot = targetIdentity.canonical;
  if (!SETUP_OPTIONS.profile.choices.includes(profile) || !SETUP_OPTIONS.backend.choices.includes(backend)) throw new Error('Unsupported setup profile/backend.');
  if (profile === 'semantic' && !model) throw new Error('Semantic planning requires an explicit --model; no download is chosen by default.');
  if (profile === 'sparse' && model) throw new Error('A selected model requires the semantic profile.');
  if (!Array.isArray(tools) || tools.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim())) throw new Error('Selected tools must be explicit nonempty tool IDs.');
  const toolRoot = resolveToolRoot();
  const configPath = path.join(repoRoot, '.pairofcleats.json');
  const currentText = readOptional(configPath);
  const rawConfig = currentText === null ? {} : parseJsoncText(currentText, configPath);
  const effective = loadUserConfig(repoRoot);
  const toolConfig = getToolingConfig(repoRoot, effective);
  const selectedTools = [...new Set(tools)].sort();
  const tooling = resolveToolsById(selectedTools, toolConfig.dir, repoRoot, toolConfig);
  const unknown = selectedTools.filter(id => !tooling.some(tool => tool.id === id));
  if (unknown.length) throw new Error('Unknown or disabled selected tools: ' + unknown.join(', '));
  const patch = {
    threads: 1,
    indexing: { concurrency: 1, ioConcurrencyCap: 1, workerPool: { enabled: false },
      embeddings: profile === 'sparse' ? { enabled: false, mode: 'off' } : { enabled: true, mode: 'auto', model },
      typeInference: profile === 'semantic' },
    search: { annDefault: profile === 'semantic' }
  };
  // Automatic provisioning would execute capabilities absent from this approval.
  patch.tooling = { autoInstallOnDetect: false };
  const candidate = mergeConfig(rawConfig, patch);
  const schema = readShippedConfigSchema(path.join(toolRoot, 'docs/config/schema.json'));
  const validation = validateConfig(schema, candidate);
  if (!validation.ok) throw new Error('Proposed setup config is invalid:\n' + validation.errors.join('\n'));
  let proposedSources;
  const proposedEffective = loadUserConfig(repoRoot, { repositoryConfig: candidate, onSources: sources => { proposedSources = sources; } });
  const blockers = [];
  const effectivePatch = [];
  const comparePatch = (value, prefix = []) => {
    for (const [key, entry] of Object.entries(value)) {
      const keys = [...prefix, key];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) comparePatch(entry, keys);
      else {
        const selected = keys.join('.') === 'tooling.autoInstallOnDetect'
          ? getToolingConfig(repoRoot, proposedEffective).autoInstallOnDetect
          : keys.reduce((parent, field) => parent?.[field], proposedEffective);
        const accepted = stableStringify(selected) === stableStringify(entry);
        effectivePatch.push({ path: keys.join('.'), requested: entry, effective: selected ?? null, accepted });
        if (!accepted) blockers.push({ code: 'requested-choice-overridden', path: keys.join('.'),
          nextAction: 'Review the winning user-owned configuration layer and generate a fresh plan.' });
      }
    }
  };
  comparePatch(patch);
  const reuseCandidates = tooling.map(tool => ({ toolId: tool.id, ...locateToolExecutable(tool) }));
  const hasReuseCandidate = id => reuseCandidates.some(entry => entry.toolId === id && entry.path && entry.source !== 'blocked');
  const prerequisitePlans = tooling.map(tool => createToolProvisioningPlan({ tool,
    selection: hasReuseCandidate(tool.id) ? { scope: 'cache', plan: null } : selectInstallPlan(tool, 'cache', false),
    isAllowed: commandPath => isResolvedCommandTrusted({ commandPath, repoRoot, toolRoot }), signal }));
  for (const tool of tooling) {
    const selected = selectInstallPlan(tool, 'cache', false);
    if (!selected.plan && !hasReuseCandidate(tool.id)) blockers.push({ code: 'selected-tool-recipe-unavailable', toolId: tool.id,
      nextAction: tool.provisioningBlocker || 'Select a qualified cache-scoped recipe for this tool/platform before applying.' });
    else if (selected.plan && !hasReuseCandidate(tool.id) && resolveDeclaredInstallAdmission(selected.plan).state !== 'estimate-declared') blockers.push({ code: 'selected-tool-storage-estimate-unavailable', toolId: tool.id,
      nextAction: selected.plan.storageAllocationBlocker?.action
        || 'The canonical recipe must declare complete artifact/build peak allocation before managed writes can be admitted.' });
  }
  for (const prerequisite of prerequisitePlans) for (const step of prerequisite.steps) {
    if (step.state === 'missing' && !step.recipe) blockers.push({ code: 'selected-prerequisite-recipe-unavailable', toolId: prerequisite.toolId,
      requirement: step.id, nextAction: step.nextAction });
  }
  const selectedModel = getModelConfig(repoRoot, proposedEffective);
  const capabilities = describeFirstSearchCapabilities({ repoRoot, userConfig: proposedEffective, profile, backend, tooling, prerequisitePlans });
  const modelReadiness = profile === 'semantic' ? resolveModelSetupReadiness({ root: repoRoot, modelConfig: selectedModel,
    embeddingsConfig: proposedEffective.indexing?.embeddings || {}, signal }) : { state: 'not-requested', runtime: 'not-probed' };
  const detected = await buildToolingReport(repoRoot, null, { skipToolDetection: true, signal });
  signal?.throwIfAborted();
  const operations = [];
  if (profile === 'semantic' && !modelReadiness.present) operations.push({ id: 'models', command: process.execPath,
    args: [path.join(toolRoot, 'tools/download/models.js'), '--repo', repoRoot, '--model', model],
    effects: ['download selected model into configured managed model location'], bytes: 'unknown' });
  if (selectedTools.length) operations.push({ id: 'tooling', command: process.execPath,
    args: [path.join(toolRoot, 'tools/tooling/install.js'), '--repo', repoRoot, '--tools', selectedTools.join(','), '--scope', 'cache', '--no-fallback', '--json'],
    output: 'selected-tool-install-receipt',
    effects: ['provision only selected tool requirements into owned locations'], bytes: 'unknown',
    recipes: tooling.map(tool => ({ id: tool.id, ...selectInstallPlan(tool, 'cache', false) })) });
  operations.push({ id: 'index', command: process.execPath,
    args: [path.join(toolRoot, 'build_index.js'), '--repo', repoRoot, '--mode', 'code', '--threads', '1', '--incremental', backend === 'sqlite' ? '--sqlite' : '--no-sqlite'],
    effects: ['build selected target code generation'], bytes: 'unknown' });
  if (backend === 'lmdb') operations.push({ id: 'lmdb', command: process.execPath,
    args: [path.join(toolRoot, 'tools/build/lmdb-index.js'), '--repo', repoRoot, '--mode', 'code'], effects: ['build selected LMDB representation'], bytes: 'unknown' });
  operations.push({ id: 'validate', command: process.execPath,
    args: [path.join(toolRoot, 'tools/index/validate.js'), '--repo', repoRoot, '--mode', 'code'], effects: ['read-only artifact validation'] });
  const setupInputs = [];
  for (const relative of ['package.json', 'package-lock.json', '.nvmrc', 'docs/config/schema.json', 'tools/setup/first-search-plan.js',
    'tools/setup/model-readiness.js', 'tools/setup/first-search-capabilities.js', 'tools/setup/first-search-suggestion.js', 'tools/shared/operator-cli-options.js',
    'src/workspace/child-runtime-env.js', 'bin/dispatch-runtime-env.js', 'tools/dict-utils/config.js', 'tools/tooling/install.js', 'tools/tooling/utils.js', 'tools/tooling/provisioning-plan.js',
    'src/shared/config-authority.js', 'src/shared/cli-option-sets.js', 'src/shared/cli-option-validators.js',
    'src/shared/runtime-envelope/resolve.js', 'src/shared/runtime-envelope/env-patch.js',
    'tools/tooling/install-execution.js', 'tools/tooling/install-allocation-contract.js', 'tools/tooling/gopls-recipe.js',
    'tools/tooling/install-storage.js', 'tools/tooling/managed-install.js', 'tools/tooling/install-go-sdk.js',
    'tools/tooling/install-clangd.js', 'src/shared/managed-clangd.js', 'src/shared/managed-tool-file.js',
    'tools/tooling/owned-detect.js', 'tools/tooling/install-preview.js', 'src/shared/managed-installation.js',
    'src/shared/managed-installation-retain.js', 'src/shared/managed-installation-contract.js', 'src/shared/toolchain-env.js',
    'src/shared/managed-go.js', 'tools/tooling/install-receipts.js', 'tools/tooling/install-requirements.js',
    'src/shared/storage/session.js', 'src/shared/storage/managed-child-session.js', 'src/shared/storage/child-environment.js',
    'src/shared/storage/failure-observation.js', 'src/shared/storage/operation-error.js',
    'src/shared/storage/admission.js', 'src/shared/storage/layout.js', 'src/shared/storage/locator-contract.js',
    'src/shared/storage/locator-read.js', 'src/shared/storage/selected-layout.js', 'src/shared/storage/inventory.js',
    'src/shared/storage/transfer.js', 'tools/download/models.js', 'src/shared/embedding-model-profile.js',
    'src/shared/embedding-model-loading.js', 'src/shared/hash.js', 'src/shared/file-read-resource.js']) {
    // One original descriptor borrower at a time. An unsettled hash cannot be
    // detached by an early Promise.all rejection while sibling reads continue.
    setupInputs.push([relative, await sha256File(path.join(toolRoot, relative), { signal })]);
  }
  signal?.throwIfAborted();
  const plan = {
    schemaVersion: 1, kind: 'first-search-plan', applicationRoot: toolRoot, repoRoot,
    choices: { profile, model, backend, tools: selectedTools },
    configPath, configPatch: patch, languages: detected.languages,
    cacheRoot: resolveRepoCacheRootPath(repoRoot, proposedEffective),
    state: blockers.length ? 'blocked' : 'planned', blockers,
    configuration: { sources: proposedSources, requestedChoices: effectivePatch, runtime: 'not-probed' }, capabilities,
    modelReadiness,
    inputIdentity: { target: targetIdentity, config: currentText === null ? null : hash(currentText), effective: hash(stableStringify(effective)),
      proposedEffective: hash(stableStringify(proposedEffective)),
      runtime: process.version, executable: process.execPath, platform: process.platform, arch: process.arch,
      setupInputs },
    prerequisites: prerequisitePlans,
    reuseCandidates: reuseCandidates.map(entry => ({ toolId: entry.toolId, path: entry.path || null,
      state: entry.path && entry.source !== 'blocked' ? 'located-not-probed' : entry.source === 'blocked' ? 'authority-blocked' : 'not-found',
      nextAction: 'Explicit apply verifies the exact selected tool before reusing bytes; location alone is not runtime or protocol readiness.' })),
    operations, readiness: 'not-probed',
    commands: { validate: [process.execPath, path.join(toolRoot, 'bin/pairofcleats.js'), 'index', 'validate', '--repo', repoRoot, '--mode', 'code'],
      search: [process.execPath, path.join(toolRoot, 'bin/pairofcleats.js'), 'search', '--repo', repoRoot, '--mode', 'code', '--backend', backend, '--top', '5', '--', '<query from your project>'] },
    notes: ['No target dependency installation or trust change.', 'Unknown bytes are not an estimate.', 'Tool installation is distinct from protocol/project qualification.']
  };
  return { ...plan, planId: hash(stableStringify(plan)) };
};

/** Re-plan from supported choices, never execute commands supplied by a saved file. */
const executeSetupStep = async (command, args, options) => {
  const result = await spawnResolvedSubprocess(command, args, { ...options, outputEncoding: 'utf8',
    maxOutputBytes: 1024 * 1024, rejectOnNonZeroExit: false });
  const observation = observeStorageResource(result, { phase: 'first-search-subprocess-result' });
  observation.requireSettled();
  let projected;
  try {
    const exitCode = result.exitCode, signal = result.signal, stdout = result.stdout;
    projected = { ok: exitCode === 0 && !signal, status: exitCode, signal,
      stdout: typeof stdout === 'string' ? stdout : null };
  } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return projected;
};

export const applyFirstSearchPlan = async (approved, { execute = executeSetupStep, signal = null, jsonOutput = false,
  resolveRuntimeEnv = resolveWorkspaceChildRuntimeEnv } = {}) => {
  if (signal?.aborted) return { schemaVersion: 1, kind: 'setup-plan-result', planId: approved?.planId || null,
    repoRoot: approved?.repoRoot || null, state: 'cancelled', completed: [], pending: ['config'],
    validation: 'not-performed-cancelled-before-planning', mutationPerformed: false };
  if (!approved || approved.kind !== 'first-search-plan' || !approved.choices || typeof approved.repoRoot !== 'string') throw new Error('A saved first-search plan is required.');
  let current;
  try { current = await createFirstSearchPlan({ ...approved.choices, repoRoot: approved.repoRoot, signal }); }
  catch (error) {
    observeStorageResource(error, { phase: 'first-search-replanning' }).requireSettled();
    if (!signal?.aborted) throw error;
    return { schemaVersion: 1, kind: 'setup-plan-result', planId: approved.planId || null,
      repoRoot: approved.repoRoot, state: 'cancelled', completed: [], pending: ['config'],
      validation: 'not-performed-cancelled-during-planning', mutationPerformed: false };
  }
  if (approved.schemaVersion !== 1 || current.planId !== approved.planId) throw Object.assign(new Error('Setup plan is stale or changed. Generate and review a new plan.'), { code: 'ERR_SETUP_PLAN_STALE' });
  if (current.blockers.length) return { schemaVersion: 1, kind: 'setup-plan-result', planId: current.planId,
    repoRoot: current.repoRoot, state: 'blocked', blockers: current.blockers, completed: [], pending: ['config', ...current.operations.map(step => step.id)] };
  const outcome = { schemaVersion: 1, kind: 'setup-plan-result', planId: current.planId,
    repoRoot: current.repoRoot, completed: [], pending: ['config', ...current.operations.map(step => step.id)], state: 'applying' };
  if (signal?.aborted) return { ...outcome, state: 'cancelled' };
  const lock = await acquireFileLock({ lockPath: `${current.configPath}.setup-lock`, waitMs: 0, signal,
    metadata: { scope: 'first-search-setup', planId: current.planId } });
  if (!lock) return { ...outcome, state: 'blocked', blockers: [{ code: 'another-setup-owner', nextAction: 'Wait for the active setup owner to settle, then re-plan.' }] };
  let pendingSettlement = false;
  let primaryError = null;
  try {
    if (stableStringify(identifySetupTarget(current.repoRoot)) !== stableStringify(current.inputIdentity.target)) throw new Error('Target directory changed before apply; re-plan.');
    const before = readOptional(current.configPath);
    if ((before === null ? null : hash(before)) !== current.inputIdentity.config) throw new Error('Target config changed before apply; re-plan.');
    let next = before || '{}\n';
    const patchLeaves = (value, prefix = []) => {
      for (const [key, entry] of Object.entries(value)) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) patchLeaves(entry, [...prefix, key]);
        else next = applyEdits(next, modify(next, [...prefix, key], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
      }
    };
    patchLeaves(current.configPatch);
    await atomicWriteText(current.configPath, next, { mkdir: false, mode: 0o600, createOnly: before === null,
      beforeCommit: () => {
        signal?.throwIfAborted();
        if (stableStringify(identifySetupTarget(current.repoRoot)) !== stableStringify(current.inputIdentity.target)) throw new Error('Target directory changed while staging; re-plan.');
        const latest = readOptional(current.configPath);
        if ((latest === null ? null : hash(latest)) !== current.inputIdentity.config) throw new Error('Target config changed while staging; re-plan.');
      } });
    outcome.completed.push('config');
    outcome.pending.shift();
    const appliedConfigHash = hash(next);
    const assertCurrentTarget = () => {
      signal?.throwIfAborted();
      if (stableStringify(identifySetupTarget(current.repoRoot)) !== stableStringify(current.inputIdentity.target)) throw new Error('Target directory changed during apply; re-plan.');
      const targetConfig = readOptional(current.configPath);
      if (targetConfig === null || hash(targetConfig) !== appliedConfigHash) throw new Error('Target config changed during apply; re-plan.');
      if (hash(stableStringify(loadUserConfig(current.repoRoot))) !== current.inputIdentity.proposedEffective) throw new Error('Effective target policy changed during apply; re-plan.');
      signal?.throwIfAborted();
    };
    for (const step of current.operations) {
      if (signal?.aborted) { outcome.state = 'cancelled'; break; }
      assertCurrentTarget();
      const env = step.id === 'index' ? await resolveRuntimeEnv({ repoRoot: current.repoRoot, buildArgs: step.args.slice(3), baseEnv: process.env }) : { ...process.env };
      observeStorageResource(env, { phase: 'first-search-startup-environment' }).requireSettled();
      assertCurrentTarget();
      const result = await execute(step.command, step.args, { cwd: current.repoRoot,
        stdio: step.output ? ['ignore', 'pipe', 'inherit'] : jsonOutput ? ['ignore', 'ignore', 'inherit'] : 'inherit', env, signal });
      const observation = observeStorageResource(result, { phase: 'first-search-step-result' });
      observation.requireSettled();
      let ok, status, childSignal, stdout;
      try { ok = result?.ok; status = result?.status; childSignal = result?.signal; stdout = result?.stdout; }
      catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
      observation.requireSettled();
      if (ok !== true || status !== 0 || childSignal || signal?.aborted) {
        outcome.state = signal?.aborted ? 'cancelled' : 'blocked';
        outcome.failed = { id: step.id, status: Number.isInteger(status) ? status : null,
          signal: typeof childSignal === 'string' ? childSignal : null };
        break;
      }
      if (step.output === 'selected-tool-install-receipt') outcome.toolingReadiness = admitFirstSearchToolReceipt(stdout,
        { repoRoot: current.repoRoot, tools: current.choices.tools });
      outcome.completed.push(step.id);
      outcome.pending.shift();
    }
    let suggestion = { state: 'not-performed', query: null };
    let commands = current.commands;
    if (outcome.pending.length === 0) {
      outcome.pending.push('first-query');
      assertCurrentTarget();
      suggestion = await resolveFirstSearchSuggestion({ repoRoot: current.repoRoot, signal });
      assertCurrentTarget();
      outcome.pending.pop();
      if (suggestion.query) commands = { ...commands, search: [...commands.search.slice(0, -1), suggestion.query] };
      outcome.state = 'complete';
    }
    return { ...outcome, commands, suggestion, capabilities: describeAppliedFirstSearchCapabilities(current, outcome),
      firstSearch: 'not-performed', qualification: 'Index validation completed only when listed; protocol/project/model inference readiness is not inferred.' };
  } catch (error) {
    let failure;
    try { failure = describeStorageFailure(error, { phase: 'first-search-step', defaultCode: 'ERR_SETUP_STEP' }); }
    catch (pending) { error = pending; }
    primaryError = error;
    outcome.state = signal?.aborted ? 'cancelled' : 'blocked';
    outcome.failed = { id: outcome.pending[0] || 'config', code: failure?.code || null,
      message: failure ? redactDiagnosticText(failure.message, 2048) : 'Actual setup resource settlement remains unresolved.' };
    if (!failure) {
      pendingSettlement = true;
      outcome.state = 'settlement-pending';
      let released = false;
      let releasing = null;
      const originalFailure = error;
      const settlement = observeStorageResource(originalFailure, { phase: 'first-search-retained-execution' });
      const session = Object.freeze({ resourceId: lock.payload.lockId,
        releaseAfterSettlement: receipt => {
          if (receipt?.resourceId !== lock.payload.lockId || receipt.settled !== true || receipt.pending !== false) throw new Error('Setup child settlement remains unconfirmed.');
          settlement.requireSettled();
          if (released) return true;
          if (!releasing) releasing = releaseFileLockOrThrow(lock).then(() => { released = true; return true; })
            .catch(releaseError => {
              releasing = null;
              throw addStorageFailureContext(originalFailure, { setupPlanSession: session, setupOutcome: outcome, setupCleanupError: releaseError },
                releaseError, { secondaryPresent: true, nonEnumerable: ['setupPlanSession'] });
            });
          return releasing;
        } });
      error = addStorageFailureContext(originalFailure, { setupPlanSession: session, setupOutcome: outcome }, undefined,
        { nonEnumerable: ['setupPlanSession'] });
      throw error;
    }
    return { ...outcome, commands: current.commands, capabilities: describeAppliedFirstSearchCapabilities(current, outcome),
      firstSearch: 'not-performed', nextAction: 'Resolve the failed step, then generate and review a fresh target-qualified plan.' };
  } finally {
    if (!pendingSettlement) {
      try { await releaseFileLockOrThrow(lock); }
      catch (error) {
        if (!primaryError) throw error;
        throw addStorageFailureContext(primaryError, { setupCleanupError: error }, error, { secondaryPresent: true });
      }
    }
  }
};
