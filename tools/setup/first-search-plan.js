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
import { buildToolingReport, resolveToolsById, selectInstallPlan } from '../tooling/utils.js';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../src/shared/locks/file-lock.js';
import { createToolProvisioningPlan } from '../tooling/provisioning-plan.js';
import { resolveModelSetupReadiness } from './model-readiness.js';
import { resolveDeclaredInstallAdmission } from '../tooling/install-execution.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const readOptional = file => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Setup config must be a bounded regular file.');
    return fs.readFileSync(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

export const createFirstSearchPlan = async ({ repoRoot, profile = 'sparse', model = null, backend = 'memory', tools = [] } = {}) => {
  repoRoot = fs.realpathSync(repoRoot);
  if (!['sparse', 'semantic'].includes(profile) || !['memory', 'sqlite', 'lmdb'].includes(backend)) throw new Error('Unsupported setup profile/backend.');
  if (profile === 'semantic' && !model) throw new Error('Semantic planning requires an explicit --model; no download is chosen by default.');
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
        const selected = keys.reduce((parent, field) => parent?.[field], proposedEffective);
        const accepted = stableStringify(selected) === stableStringify(entry);
        effectivePatch.push({ path: keys.join('.'), requested: entry, effective: selected ?? null, accepted });
        if (!accepted) blockers.push({ code: 'requested-choice-overridden', path: keys.join('.'),
          nextAction: 'Review the winning user-owned configuration layer and generate a fresh plan.' });
      }
    }
  };
  comparePatch(patch);
  const prerequisitePlans = tooling.map(tool => createToolProvisioningPlan({ tool, selection: selectInstallPlan(tool, 'cache', false) }));
  for (const tool of tooling) {
    const selected = selectInstallPlan(tool, 'cache', false);
    if (!selected.plan) blockers.push({ code: 'selected-tool-recipe-unavailable', toolId: tool.id,
      nextAction: tool.provisioningBlocker || 'Select a qualified cache-scoped recipe for this tool/platform before applying.' });
    else if (resolveDeclaredInstallAdmission(selected.plan).requiredBytes === null) blockers.push({ code: 'selected-tool-storage-estimate-unavailable', toolId: tool.id,
      nextAction: 'The canonical recipe must declare complete artifact/build peak allocation before managed writes can be admitted.' });
  }
  for (const prerequisite of prerequisitePlans) for (const step of prerequisite.steps) {
    if (step.state === 'missing' && !step.recipe) blockers.push({ code: 'selected-prerequisite-recipe-unavailable', toolId: prerequisite.toolId,
      requirement: step.id, nextAction: step.nextAction });
  }
  const selectedModel = getModelConfig(repoRoot, proposedEffective);
  const modelReadiness = profile === 'semantic' ? resolveModelSetupReadiness({ root: repoRoot, modelConfig: selectedModel,
    embeddingsConfig: proposedEffective.indexing?.embeddings || {} }) : { state: 'not-requested', runtime: 'not-probed' };
  const detected = await buildToolingReport(repoRoot, null, { skipToolDetection: true });
  const operations = [];
  if (profile === 'semantic') operations.push({ id: 'models', command: process.execPath,
    args: [path.join(toolRoot, 'tools/download/models.js'), '--repo', repoRoot, '--model', model],
    effects: ['download selected model into configured managed model location'], bytes: 'unknown' });
  if (selectedTools.length) operations.push({ id: 'tooling', command: process.execPath,
    args: [path.join(toolRoot, 'tools/tooling/install.js'), '--repo', repoRoot, '--tools', selectedTools.join(','), '--scope', 'cache', '--no-fallback'],
    effects: ['provision only selected tool requirements into owned locations'], bytes: 'unknown',
    recipes: tooling.map(tool => ({ id: tool.id, ...selectInstallPlan(tool, 'cache', false) })) });
  operations.push({ id: 'index', command: process.execPath,
    args: [path.join(toolRoot, 'build_index.js'), '--repo', repoRoot, '--mode', 'code', '--threads', '1', ...(backend === 'sqlite' ? [] : ['--no-sqlite'])],
    effects: ['build selected target code generation'], bytes: 'unknown' });
  if (backend === 'lmdb') operations.push({ id: 'lmdb', command: process.execPath,
    args: [path.join(toolRoot, 'tools/build/lmdb-index.js'), '--repo', repoRoot, '--mode', 'code'], effects: ['build selected LMDB representation'], bytes: 'unknown' });
  operations.push({ id: 'validate', command: process.execPath,
    args: [path.join(toolRoot, 'tools/index/validate.js'), '--repo', repoRoot, '--mode', 'code'], effects: ['read-only artifact validation'] });
  const plan = {
    schemaVersion: 1, kind: 'first-search-plan', applicationRoot: toolRoot, repoRoot,
    choices: { profile, model, backend, tools: selectedTools },
    configPath, configPatch: patch, languages: detected.languages,
    cacheRoot: resolveRepoCacheRootPath(repoRoot, proposedEffective),
    state: blockers.length ? 'blocked' : 'planned', blockers,
    configuration: { sources: proposedSources, requestedChoices: effectivePatch, runtime: 'not-probed' },
    modelReadiness,
    inputIdentity: { config: currentText === null ? null : hash(currentText), effective: hash(stableStringify(effective)),
      runtime: process.version, executable: process.execPath, platform: process.platform, arch: process.arch,
      setupInputs: ['package.json', 'package-lock.json', '.nvmrc', 'docs/config/schema.json', 'tools/setup/first-search-plan.js',
        'tools/setup/model-readiness.js', 'tools/dict-utils/config.js', 'tools/tooling/install.js', 'tools/tooling/utils.js', 'tools/tooling/provisioning-plan.js']
        .map(relative => [relative, hash(fs.readFileSync(path.join(toolRoot, relative)))]) },
    prerequisites: prerequisitePlans,
    operations, readiness: 'not-probed',
    commands: { validate: ['node', 'bin/pairofcleats.js', 'index', 'validate', '--repo', repoRoot, '--mode', 'code'],
      search: ['node', 'bin/pairofcleats.js', 'search', '--repo', repoRoot, '--mode', 'code', '--backend', backend, '--top', '5', '--', '<query from your project>'] },
    notes: ['No target dependency installation or trust change.', 'Unknown bytes are not an estimate.', 'Tool installation is distinct from protocol/project qualification.']
  };
  return { ...plan, planId: hash(stableStringify(plan)) };
};

/** Re-plan from supported choices, never execute commands supplied by a saved file. */
const executeSetupStep = async (command, args, options) => {
  const result = await spawnResolvedSubprocess(command, args, { ...options, outputEncoding: 'utf8',
    maxOutputBytes: 1024 * 1024, rejectOnNonZeroExit: false });
  return { ok: result.exitCode === 0, status: result.exitCode, signal: result.signal };
};

export const applyFirstSearchPlan = async (approved, { execute = executeSetupStep, signal = null, jsonOutput = false } = {}) => {
  const current = await createFirstSearchPlan({ repoRoot: approved.repoRoot, ...approved.choices });
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
        const latest = readOptional(current.configPath);
        if ((latest === null ? null : hash(latest)) !== current.inputIdentity.config) throw new Error('Target config changed while staging; re-plan.');
      } });
    outcome.completed.push('config');
    outcome.pending.shift();
    for (const step of current.operations) {
      if (signal?.aborted) { outcome.state = 'cancelled'; break; }
      const result = await execute(step.command, step.args, { cwd: current.applicationRoot,
        stdio: jsonOutput ? ['ignore', 'ignore', 'inherit'] : 'inherit', env: process.env, signal });
      if (result.ok !== true) {
        outcome.state = 'blocked';
        outcome.failed = { id: step.id, status: result.status ?? null, signal: result.signal || null };
        break;
      }
      outcome.completed.push(step.id);
      outcome.pending.shift();
    }
    if (outcome.pending.length === 0) outcome.state = 'complete';
    return { ...outcome, commands: current.commands, qualification: 'Index validation completed only when listed; protocol/project/model inference readiness is not inferred.' };
  } catch (error) {
    primaryError = error;
    outcome.state = signal?.aborted ? 'cancelled' : 'blocked';
    outcome.failed = { id: outcome.pending[0] || 'config', code: error.code || null };
    if (error.cacheOwnershipPending) {
      pendingSettlement = true;
      outcome.state = 'settlement-pending';
      Object.defineProperty(error, 'setupPlanSession', { configurable: true, value: { resourceId: lock.payload.lockId,
        releaseAfterSettlement: receipt => {
          if (receipt?.resourceId !== lock.payload.lockId || receipt.settled !== true || receipt.pending === true) throw new Error('Setup child settlement remains unconfirmed.');
          return releaseFileLockOrThrow(lock);
        } } });
      error.setupOutcome = outcome;
      throw error;
    }
    return { ...outcome, commands: current.commands };
  } finally {
    if (!pendingSettlement) {
      try { await releaseFileLockOrThrow(lock); }
      catch (error) {
        if (!primaryError) throw error;
        primaryError.setupCleanupError = error;
        throw primaryError;
      }
    }
  }
};
