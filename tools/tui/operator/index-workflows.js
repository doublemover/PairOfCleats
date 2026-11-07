import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { assertTuiWorkflowRequest } from '../../../src/contracts/validators/tui-workflow.js';
import { validateConfig } from '../../../src/config/validate.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { loadUserConfig, getModelConfig, getRepoCacheRoot, getCacheRoot } from '../../../src/shared/dict-utils.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { mergeConfig } from '../../../src/shared/config.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { buildAutoPolicy } from '../../../src/shared/auto-policy/build.js';
import { clampQuality } from '../../../src/shared/auto-policy/profile.js';
import { assertIndexValidationFlags, assertIndexStatsFlags, resolveWorkspaceBuildConcurrency } from '../../../src/shared/index-tool-options.js';
import { resolveEmbeddingIntent } from '../../../src/shared/embedding-intent.js';
import { normalizeEmbeddingProvider } from '../../../src/shared/onnx-embeddings/config.js';
import { resolveEmbeddingModelProfile, validateEmbeddingModelProfile } from '../../../src/shared/embedding-model-profile.js';
import { buildStageOverrides } from '../../../src/index/build/runtime/stage.js';
import { normalizeIndexBuildStage } from '../../../src/shared/indexing/stages.js';
import { parseBuildArgs } from '../../../src/index/build/args.js';
import { readCurrentBuildGeneration } from '../../../src/shared/indexing/build-generation.js';
import { sameIdentityPath } from '../../../src/shared/indexing/build-pointer-roots.js';
import { readVerifiedContainedFileSync, assertNoSymlinkPath } from '../../../src/shared/contained-file.js';
import { BUILD_STATE_SCHEMA } from '../../../src/contracts/schemas/build-state.js';
import { sanitizeRuntimeReceipt } from '../../../src/shared/runtime-envelope/receipt.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { createObservabilityEnvelope, applyObservabilityContextEnv } from '../../../src/shared/observability.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { resolveModelSetupReadiness } from '../../setup/model-readiness.js';
import { describeIndexWorkflows, describeWorkflowCoverage, buildIndexWorkflowArgv } from './index-catalog.js';
import { inspectBootstrapReadiness } from '../../../src/shared/bootstrap-readiness.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createTuiMcpClients } from './mcp-client.js';
import { createTuiSemanticPages, SEMANTIC_PAGED_COMMANDS } from './semantic-pages.js';
import { prepareTuiStorage, NATIVE_STORAGE_COMMANDS } from './storage.js';
import { createTuiIndexer } from './indexer.js';
import { createTuiApiServices } from './api-service.js';
import { createTuiCacheMaintenance, NATIVE_BACKEND_MAINTENANCE } from './cache-maintenance.js';
import { settleOwnedActions, ownedCleanupIsPending } from './settle-owned.js';
import { createTuiServiceControls } from './service-controls.js';
import { createTuiRetainedGraphs } from './retained-graph.js';

const MAX_REPOS = 32;
const MAX_PLANS = 16;
const TTL_MS = 5 * 60 * 1000;
const BUILDERS = new Set(['index.build', 'index.watch', 'workspace.build']);
const SETUP = new Set(['setup', 'bootstrap', 'tooling.install']);
const retainedMap = (command, values) => command.registryId === 'report.map' && Object.hasOwn(values, 'index-root');
const effects = command => SETUP.has(command.registryId)
  ? 'Setup can download/install dependencies, models, dictionaries or tooling, modify selected configuration and build indexes. Review every skip/scope field; credentials use the existing private environment/config handoff.'
  : command.registryId === 'service.mcp' ? 'Start a session-owned framed MCP client/server pair for this repository. Health verifies initialize and tools/list responses only. No arbitrary tool execution or external attachment is admitted. Cancel settles the owned process tree.'
    : command.registryId === 'service.api' ? 'Start a session-owned API child bound to 127.0.0.1 only. Credentials come from the existing private API token environment; no token is accepted in this form. A running PID is not health evidence. Cancel stops only this owned job.'
      : command.registryId === 'cache.gc' ? 'Canonical cache garbage collection can cover shared cache roots. apply=true mutates; review exact roots and retention limits. Existing active-owner exclusions remain enforced by the canonical GC.'
        : command.registryId.startsWith('report.') ? 'Generate a scoped report/evaluation. Explicit output paths may be written; build flags can start expensive work. Native result views retain bounded producer JSON, including uncertainty and partial coverage.'
          : 'Run the selected canonical command under supervisor ownership; review exact scope, inputs and argv. Exit success alone does not establish artifact readiness.';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const fingerprint = value => createHash('sha256').update(stableStringify(value)).digest('hex');

/** Bounded observations of the published pointer and its validated producer state.
 * These observations never grant artifact or process authority.
 */
export const observeIndexPublication = async (repo, config, { signal, validateCurrent = true } = {}) => {
  throwIfAborted(signal);
  const repoCacheRoot = getRepoCacheRoot(repo, config), buildsRoot = path.join(repoCacheRoot, 'builds');
  const currentJsonPath = path.join(buildsRoot, 'current.json');
  try {
    let pointerHash = null;
    try { pointerHash = readVerifiedContainedFileSync(repoCacheRoot, currentJsonPath, { maxBytes: 1024 * 1024 }).hash; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const generation = readCurrentBuildGeneration({ repoRoot: repo, repoCacheRoot, buildsRoot, currentJsonPath });
    if (!generation.parseOk) return { repo, generation, published: false, validated: false, ready: false };
    const root = generation.buildRoot || generation.activeRoot;
    const read = readVerifiedContainedFileSync(repoCacheRoot, path.join(root, 'build_state.json'), { maxBytes: 8 * 1024 * 1024 });
    const state = JSON.parse(read.buffer.toString('utf8'));
    const valid = validateConfig(BUILD_STATE_SCHEMA, state);
    const matching = valid.ok && state.buildId === generation.buildId && sameIdentityPath(state.buildRoot, root);
    const validation = matching ? state.validation ?? null : null;
    const promoted = matching && state.phases?.promote?.status === 'done';
    const currentValidation = validateCurrent && matching && promoted
      ? await validateIndexArtifacts({ root: repo, userConfig: config, modes: state.modes, strict: true, signal }) : null;
    throwIfAborted(signal);
    const unchanged = readVerifiedContainedFileSync(repoCacheRoot, currentJsonPath, { maxBytes: 1024 * 1024 }).hash === pointerHash
      && readVerifiedContainedFileSync(repoCacheRoot, path.join(root, 'build_state.json'), { maxBytes: 8 * 1024 * 1024 }).hash === read.hash;
    return { repo, generation, published: true, validated: validation?.ok === true, promoted,
      ready: validateCurrent ? matching && validation?.ok === true && promoted && currentValidation?.ok === true && unchanged : null,
      readinessCheck: validateCurrent ? 'canonical-current-artifact-validation' : 'not-requested',
      producerContractValid: matching, validation, observationUnchanged: unchanged,
      currentValidation: currentValidation ? { ok: currentValidation.ok, strict: currentValidation.strict,
        issues: currentValidation.issues.slice(0, 10), warningCount: currentValidation.warnings.length } : null,
      validatedModes: matching ? state.modes : [], stage: matching ? state.stage : null,
      producerCorrelations: matching ? state.runtime?.attempts?.filter(attempt => attempt.lifecycle === 'succeeded')
        .map(attempt => attempt.correlationId).filter(Boolean) || [] : [],
      phases: matching ? Object.fromEntries(Object.entries(state.phases).slice(0, 32)
        .map(([key, value]) => [key, { status: value.status, updatedAt: value.updatedAt, finishedAt: value.finishedAt ?? null }])) : null,
      note: 'Current published generation observed independently of this process exit status.' };
  } catch (error) {
    throwIfAborted(signal);
    return { repo, generation: null, published: false, validated: false, ready: false,
      errorCode: String(error.code || 'ERR_TUI_PUBLICATION_OBSERVATION') };
  }
};

/** Private, expiring typed plans. Reuses scope, build/config/model, and job owners. */
export const createTuiIndexWorkflows = ({ scopes, startJob, toolRoot = process.cwd(), env = process.env, now = Date.now,
  drainLocalReaders = null, backendDelegationEnabled = false, getJob = null, cancelJob = null } = {}) => {
  const plans = new Map();
  const backendEnabled = backendDelegationEnabled === true && typeof drainLocalReaders === 'function';
  let experimentalEnabled = false;
  let commands = describeIndexWorkflows({ backendDelegationEnabled: backendEnabled });
  let disposed = false;
  const requireScope = id => {
    if (disposed) fail('ERR_TUI_SESSION_CLOSED', 'The workflow session has closed.');
    return scopes.captureScope(id);
  };
  const serviceControls = createTuiServiceControls({ requireScope, getJob, cancelJob });
  const mcp = createTuiMcpClients({ toolRoot, requireScope });
  const semantic = createTuiSemanticPages({ toolRoot, requireScope, now });
  const indexer = createTuiIndexer({ toolRoot, requireScope, env });
  const api = createTuiApiServices({ toolRoot, requireScope });
  const graphs = createTuiRetainedGraphs({ toolRoot, requireScope });
  const maintenance = createTuiCacheMaintenance({ toolRoot, requireScope, env, delegationEnabled: backendEnabled,
    drainLocalReaders: drainLocalReaders ? async input => {
      const drained = await drainLocalReaders(input);
      await semantic.dispose();
      return drained;
    } : null });
  const targets = (scope, values = {}) => {
    if (scope.kind === 'repo') return [scope.configRoot];
    const repos = loadWorkspaceConfig(scope.target).repos.filter(repo => values['include-disabled'] || repo.enabled);
    if (repos.length > MAX_REPOS) fail('ERR_TUI_WORKFLOW_SCOPE_LIMIT', 'Choose a workspace with at most 32 selected repositories.');
    return repos.map(repo => repo.repoRootCanonical);
  };
  const inspect = async (scope, command, values, signal) => {
    if (command.unsupportedReason) fail('ERR_TUI_WORKFLOW_UNSUPPORTED', command.unsupportedReason);
    if (command.registryId === 'index.validate') assertIndexValidationFlags(values);
    if (command.registryId === 'index.stats') assertIndexStatsFlags({ ...values, repo: scope.target });
    if (command.registryId === 'workspace.build' && values.concurrency !== undefined) resolveWorkspaceBuildConcurrency(values.concurrency);
    if (BUILDERS.has(command.registryId)) {
      if (values.stage && !normalizeIndexBuildStage(values.stage)) fail('ERR_TUI_WORKFLOW_STAGE', 'Choose a canonical build stage.');
      if (values.quality && !clampQuality(values.quality)) fail('ERR_TUI_WORKFLOW_QUALITY', 'Choose a canonical build quality.');
    }
    const observations = [];
    for (const repo of targets(scope, values)) {
      throwIfAborted(signal);
      let sources;
      const config = loadUserConfig(repo, { env, onSources: value => { sources = value; } });
      const observation = { repo, configFingerprint: fingerprint({ config, sources }),
        publication: retainedMap(command, values) ? { observed: false, ready: null, reason: 'explicit-retained-graph-selection' }
          : await observeIndexPublication(repo, config, { signal, validateCurrent: false }) };
      observation.scopeImpact = { repository: repo, repoCacheRoot: getRepoCacheRoot(repo, config),
        ...(command.registryId === 'cache.gc' || SETUP.has(command.registryId) ? { sharedCacheRoot: getCacheRoot() } : {}) };
      if (command.registryId === 'tooling.doctor' || SETUP.has(command.registryId)) {
        observation.runtime = { executable: process.execPath, version: process.version, abi: process.versions.modules,
          platform: process.platform, architecture: process.arch, bootstrap: await inspectBootstrapReadiness({ root: toolRoot }) };
      }
      const inputs = {};
      for (const name of ['request', 'rules', 'changedFile', 'dataset', 'queries']) if (typeof values[name] === 'string' && values[name]) {
        const file = path.resolve(scope.configRoot, values[name]);
        const read = readVerifiedContainedFileSync(scope.configRoot, file, { maxBytes: 1024 * 1024 });
        inputs[name] = { path: file, sha256: read.hash };
        if (name === 'request' && command.requestFile) {
          const request = JSON.parse(read.buffer.toString('utf8'));
          if (typeof request.repoRoot !== 'string' || !sameIdentityPath(path.resolve(scope.configRoot, request.repoRoot), repo)) {
            fail('ERR_TUI_WORKFLOW_SCOPE', 'The saved request must name the selected repository as repoRoot.');
          }
          if (SEMANTIC_PAGED_COMMANDS.has(command.registryId) && request.cursor) {
            fail('ERR_TUI_SEMANTIC_REQUEST', 'Open a fresh request without a cursor; native continuation retains the issuing process.');
          }
        }
      }
      observation.inputFiles = inputs;
      const outputs = {};
      for (const name of ['out', 'model-out', 'node-list-out', 'log-file']) if (typeof values[name] === 'string' && values[name]) {
        const file = path.resolve(scope.configRoot, values[name]);
        assertNoSymlinkPath(scope.configRoot, file, { allowMissing: true });
        try { outputs[name] = { path: file, before: readVerifiedContainedFileSync(scope.configRoot, file, { maxBytes: 1024 * 1024 }).hash }; }
        catch (error) { if (error.code !== 'ENOENT') throw error; outputs[name] = { path: file, before: 'missing' }; }
      }
      observation.outputFiles = outputs;
      if (BUILDERS.has(command.registryId)) {
        // Canonical argument validation also owns modes, stages and conflicts.
        const buildValues = Object.fromEntries(Object.entries(values)
          .filter(([key]) => !['concurrency', 'strict', 'include-disabled'].includes(key)));
        const buildCommand = { ...command, fields: command.fields.filter(field => Object.hasOwn(buildValues, field.name)),
          commandPath: ['index', 'build'] };
        const argv = buildIndexWorkflowArgv(buildCommand, buildValues, { kind: 'repo', target: repo }).slice(2);
        const parsed = parseBuildArgs(argv).argv;
        const policy = await buildAutoPolicy({ repoRoot: repo, config: values.quality ? { ...config, quality: values.quality } : config });
        let indexing = config.indexing || {};
        if (policy.indexing?.hugeRepoProfile?.enabled && indexing.hugeRepoProfile?.enabled !== false) {
          indexing = mergeConfig(indexing, policy.indexing.hugeRepoProfile.overrides || {});
        }
        const stage = normalizeIndexBuildStage(values.stage || getEnvConfig(env).stage);
        const configured = indexing.embeddings || {};
        const enabled = resolveEmbeddingIntent({ argv: parsed, embeddingsConfig: configured,
          envConfig: getEnvConfig(env), policyEnabled: policy.indexing?.embeddings?.enabled }).embeddingEnabled;
        indexing = mergeConfig(indexing, { embeddings: { enabled } });
        if (stage && stage !== 'stage3') indexing = mergeConfig(indexing, buildStageOverrides(indexing.twoStage || {}, stage) || {});
        const embeddings = indexing.embeddings || {};
        const provider = normalizeEmbeddingProvider(embeddings.provider, { strict: true });
        const model = { ...getModelConfig(repo, config), ...(values.model ? { id: values.model } : {}) };
        const intent = resolveEmbeddingIntent({ argv: parsed, embeddingsConfig: embeddings, envConfig: getEnvConfig(env) });
        validateEmbeddingModelProfile(resolveEmbeddingModelProfile(model.id, embeddings.embeddinggemma2),
          { provider, normalize: embeddings.normalize !== false });
        const assets = intent.embeddingEnabled && !intent.embeddingService && !intent.useStubEmbeddings
          ? resolveModelSetupReadiness({ root: repo, modelConfig: model, embeddingsConfig: embeddings }) : null;
        observation.embeddings = { ...intent, provider, modelId: model.id,
          assets, runtimeQualified: false,
          note: 'Asset checks do not initialize a provider or qualify inference. Provider and backend configuration use Settings.' };
        observation.backends = { sqlite: values.sqlite ?? config.sqlite?.use ?? true, lmdb: config.lmdb?.use ?? null };
      }
      observations.push(observation);
    }
    throwIfAborted(signal);
    requireScope(scope.id);
    return observations;
  };
  const describe = request => {
    assertTuiWorkflowRequest('describe', request);
    experimentalEnabled = request.includeExperimental === true;
    commands = describeIndexWorkflows({ includeExperimental: experimentalEnabled, backendDelegationEnabled: backendEnabled });
    return { commands: structuredClone(commands), coverage: describeWorkflowCoverage({ backendDelegationEnabled: backendEnabled }), experimentalEnabled,
      limits: { maxRepos: MAX_REPOS, maxPreviews: MAX_PLANS, previewTtlMs: TTL_MS },
      embeddingSettings: ['indexing.embeddings.provider', 'indexing.embeddings.mode', 'indexing.embeddings.onnx', 'models'],
      note: 'Model/provider configuration uses the canonical settings schema; embeddings run within index build/watch. All launches require a fresh explicit preview.' };
  };
  const preview = async (request, { signal } = {}) => {
    assertTuiWorkflowRequest('preview', request);
    const scope = requireScope(request.scopeId);
    const command = commands.find(command => command.id === request.commandId);
    if (!command || command.scopeKind !== scope.kind) fail('ERR_TUI_WORKFLOW_COMMAND', 'Choose a command for the selected scope.');
    if (command.unsupportedReason) return { launchable: false, errors: [command.unsupportedReason], errorCode: 'ERR_TUI_WORKFLOW_UNSUPPORTED' };
    const validation = validateConfig(command.schema, request.values);
    if (!validation.ok) return { launchable: false, errors: validation.errors };
    const values = structuredClone(request.values);
    let argv, observations, storage = null, service = null, backend = null, graph = null;
    try {
      argv = buildIndexWorkflowArgv(command, values, scope, { env });
      if (argv.some(value => sanitizeRuntimeReceipt(value) !== value)) {
        return { launchable: false, errors: ['Use private Settings for credentials; command forms do not accept values that require redaction.'] };
      }
      observations = await inspect(scope, command, values, signal);
    }
    catch (error) {
      if (ownedCleanupIsPending(error)) throw error;
      throwIfAborted(signal);
      return { launchable: false, errors: [sanitizeRuntimeReceipt(error.message)],
        errorCode: error.code || 'ERR_TUI_WORKFLOW_PREFLIGHT' };
    }
    if (NATIVE_STORAGE_COMMANDS.has(command.registryId)) {
      try { storage = await prepareTuiStorage({ commandId: command.registryId, values, env, scope, requireScope, signal }); }
      catch (error) { throwIfAborted(signal); return { launchable: false, errors: [sanitizeRuntimeReceipt(error.message)],
        errorCode: error.code || 'ERR_TUI_STORAGE_PREVIEW' }; }
    }
    if (command.registryId === 'service.indexer') {
      try { service = await indexer.prepare({ scope, values, signal }); }
      catch (error) { throwIfAborted(signal); return { launchable: false, errors: [sanitizeRuntimeReceipt(error.message)],
        errorCode: error.code || 'ERR_TUI_INDEXER_PREVIEW' }; }
    }
    if (NATIVE_BACKEND_MAINTENANCE.has(command.registryId)) {
      try { backend = await maintenance.prepare({ scope, command, values, argv, signal }); }
      catch (error) { throwIfAborted(signal); return { launchable: false, errors: [sanitizeRuntimeReceipt(error.message)],
        errorCode: error.code || 'ERR_TUI_BACKEND_PREVIEW' }; }
    }
    if (retainedMap(command, values)) {
      try { graph = await graphs.prepare({ scope, values, argv, signal }); }
      catch (error) {
        if (ownedCleanupIsPending(error)) throw error;
        throwIfAborted(signal); return { launchable: false, errors: [sanitizeRuntimeReceipt(error.message)],
          errorCode: error.code || 'ERR_TUI_GRAPH_PREVIEW' };
      }
    }
    const errors = observations.flatMap(row => row.embeddings?.assets && !row.embeddings.assets.present
      ? [`${row.repo}: ${row.embeddings.assets.reason}`] : []);
    if (storage) errors.push(...storage.review.errors);
    if (graph) errors.push(...graph.review.errors);
    const result = { scope, command, canonicalArgv: storage || service || backend || graph ? null : argv,
      ...(storage ? { storageReview: storage.review,
        executionOwner: 'src/shared/storage: direct typed API; no serialized caller plan grants authority' } : {}),
      ...(service ? { serviceReview: service.review,
        executionOwner: 'Existing service queue claim/lease/executor/completion owners; scope-filtered claims and local cancellation.' } : {}),
      ...(backend ? { backendReview: backend.review, executionOwner: 'authenticated canonical exclusive child delegation' } : {}),
      ...(graph ? { graphReview: graph.review, executionOwner: 'canonical retained graph recovery and exact immutable reader callback' } : {}),
      observations: observations.map(({ configFingerprint: _private, ...observation }) => observation), errors, launchable: errors.length === 0,
      effect: graph ? graph.review.effect : BUILDERS.has(command.registryId) ? 'Build selected indexes; watch remains running until cancelled.'
        : command.id.match(/snapshot\.(remove|gc|prune|freeze|create)$/) ? 'Snapshot operation; review dry-run, retention and force selections.'
          : effects(command) };
    if (result.launchable) {
      if (Buffer.byteLength(JSON.stringify(result)) > 768 * 1024
        || Buffer.byteLength(JSON.stringify({ scope, command, values, argv, observations })) > 768 * 1024) {
        return { launchable: false, errors: ['Narrow this scope; the launch preview exceeds its byte bound.'] };
      }
      const previewId = randomUUID();
      const jobId = `workflow-${randomUUID()}`;
      if (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value);
      plans.set(previewId, { scope, command, values, argv, observations, storage, service, backend, graph, jobId, createdAt: now() });
      result.previewId = previewId;
      result.plannedJobId = jobId;
    }
    return sanitizeRuntimeReceipt(result);
  };
  const findPlan = request => {
    const scope = requireScope(request.scopeId), plan = plans.get(request.previewId);
    if (!plan || plan.scope.id !== scope.id || now() - plan.createdAt > TTL_MS
      || (plan.command.supportTier === 'experimental' && !experimentalEnabled)) {
      plans.delete(request.previewId);
      fail('ERR_TUI_WORKFLOW_STALE', 'The preview expired or the scope changed. Preview again.');
    }
    return plan;
  };
  const launch = async (request, { signal, operationOwner } = {}) => {
    assertTuiWorkflowRequest('launch', request);
    const plan = findPlan(request);
    plans.delete(request.previewId);
    throwIfAborted(signal);
    const jobId = plan.jobId;
    const serviceKind = ['service.api', 'service.mcp'].includes(plan.command.registryId)
      || plan.command.registryId === 'service.indexer' && plan.values.command === 'work'
      ? plan.command.registryId.slice('service.'.length) : null;
    // Reserve control capacity before startJob can admit/spawn anything. Keep
    // that slot across async admission so parallel launches cannot overbook it.
    const serviceReservation = serviceKind ? serviceControls.reserve({ scopeId: plan.scope.id, kind: serviceKind }) : null;
    try {
      const check = async ({ signal }) => {
        requireScope(plan.scope.id);
        const current = await inspect(plan.scope, plan.command, plan.values, signal);
        if (current.some((row, index) => row.repo !== plan.observations[index]?.repo
        || row.configFingerprint !== plan.observations[index]?.configFingerprint
        || fingerprint(row.inputFiles) !== fingerprint(plan.observations[index]?.inputFiles)
        || fingerprint(row.outputFiles) !== fingerprint(plan.observations[index]?.outputFiles)
        || (row.embeddings?.assets && !row.embeddings.assets.present))) {
          fail('ERR_TUI_WORKFLOW_STALE', 'Configuration, model readiness or workspace membership changed. Preview again.');
        }
      };
      // Admission and cancellation remain in the existing supervisor registry.
      await startJob({ jobId, title: plan.command.commandPath.join(' '), argv: plan.argv,
        cwd: plan.scope.configRoot, retry: { maxAttempts: 1, delayMs: 0 },
        envPatch: applyObservabilityContextEnv({}, createObservabilityEnvelope({ surface: 'tui',
          operation: plan.command.id, correlation: { correlationId: jobId } })),
        resultPolicy: { captureStdout: BUILDERS.has(plan.command.registryId) ? 'text' : plan.command.capture || 'json', maxBytes: 768 * 1024 } }, {
        beforeRun: check,
        ...(plan.backend ? { execute: context => plan.backend.execute({ ...context, launcherJob: operationOwner }) }
          : plan.graph ? { execute: plan.graph.execute }
            : plan.storage ? { execute: plan.storage.execute } : plan.service ? { execute: plan.service.execute }
              : plan.command.registryId === 'service.api' ? {
                execute: context => api.run({ scope: plan.scope, jobId, argv: plan.argv }, context)
              } : plan.command.registryId === 'service.mcp' ? {
                execute: context => mcp.run({ scope: plan.scope, jobId }, context)
              } : SEMANTIC_PAGED_COMMANDS.has(plan.command.registryId) ? {
                execute: async context => {
                  const input = plan.observations[0].inputFiles.request;
                  const read = readVerifiedContainedFileSync(plan.scope.configRoot, input.path, { maxBytes: 768 * 1024 });
                  if (read.hash !== input.sha256) fail('ERR_TUI_WORKFLOW_STALE', 'The semantic request changed after preview.');
                  const result = await semantic.open({ scope: plan.scope, commandId: plan.command.registryId,
                    request: JSON.parse(read.buffer.toString('utf8')), requestSha256: read.hash }, context);
                  return { exitCode: 0, stdout: JSON.stringify(result), signal: null };
                }
              } : {}),
        afterRun: async ({ payload, signal }) => {
          if (plan.graph) return { workflow: { commandId: plan.command.id, processStatus: payload.status,
            publications: [], graphOnly: true, graphRetirements: graphs.status(plan.scope.id),
            note: 'The selected retained graph has its own receipt; no normal search readiness or current publication was requested.' } };
          const backendState = maintenance.status();
          if (plan.backend && backendState?.blocked) return { workflow: { commandId: plan.command.id,
            processStatus: payload.status, maintenance: backendState, publications: [], observed: false } };
          let verification = null;
          if (SETUP.has(plan.command.registryId)) {
            const bootstrap = await inspectBootstrapReadiness({ root: toolRoot });
            try {
              const child = await spawnSubprocess(process.execPath, [path.join(toolRoot, 'bin/pairofcleats.js'),
                'tooling', 'doctor', `--repo=${plan.scope.configRoot}`, '--json'], {
                cwd: plan.scope.configRoot, env, signal, timeoutMs: 10000, maxOutputBytes: 512 * 1024,
                stdio: ['ignore', 'pipe', 'pipe'], rejectOnNonZeroExit: false });
              const complete = !child.outputCapture?.stdout?.truncated && !child.outputCapture?.stdout?.encodingLoss;
              const doctor = complete ? JSON.parse(child.stdout) : null;
              verification = { bootstrap, doctor: sanitizeRuntimeReceipt(doctor), processExitCode: child.exitCode,
                ready: bootstrap.ready === true && child.exitCode === 0 && doctor?.summary?.status === 'ok',
                note: 'Fresh bootstrap and canonical doctor observations; install process exit is not readiness.' };
            } catch (error) { verification = { bootstrap, ready: false, errorCode: error.code || 'ERR_TUI_SETUP_VERIFICATION',
              note: 'Post-install verification did not complete; readiness remains unverified.' }; }
          }
          const publications = [];
          // Read-only commands and snapshot maintenance do not produce a ready
          // index. Their process results remain distinct from an explicit status
          // validation; avoid repeatedly scanning all artifacts after each one.
          const validateCurrent = payload.status === 'done' && BUILDERS.has(plan.command.registryId);
          const observationSignal = validateCurrent ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : undefined;
          for (const repo of targets(plan.scope, plan.values)) {
            publications.push(await observeIndexPublication(repo, loadUserConfig(repo, { env }),
              { signal: observationSignal, validateCurrent }));
          }
          return { workflow: { commandId: plan.command.id, processStatus: payload.status, verification,
            ...(plan.backend ? { maintenance: backendState } : {}),
            publications: publications.map((row, index) => {
              const changed = row.generation?.generationKey !== plan.observations[index]?.publication.generation?.generationKey;
              return { ...row, changedSincePreview: changed,
                producedReadyGeneration: BUILDERS.has(plan.command.registryId) && payload.status === 'done'
                && row.ready === true && row.producerCorrelations?.includes(jobId) === true };
            }) } };
        }
      });
      const serviceControlId = serviceKind ? serviceControls.register({ scopeId: plan.scope.id, kind: serviceKind, jobId,
        reservation: serviceReservation,
        inspectClosure: () => {
          const owner = { api, mcp, indexer }[serviceKind];
          return { closed: !owner.status(plan.scope.id).some(entry => entry.jobId === jobId) };
        } }) : null;
      return { launched: true, jobId, commandId: plan.command.id, canonicalArgv: plan.storage || plan.service || plan.backend || plan.graph ? null : plan.argv,
        ...(serviceKind ? { serviceControlId } : {}),
        ...(plan.storage || plan.service || plan.backend || plan.graph ? { executionOwner: plan.graph ? 'canonical-retained-graph-capability'
          : plan.backend ? 'authenticated-canonical-cache-child'
            : plan.storage ? 'canonical-storage-api' : 'canonical-service-worker-owners' } : {}),
        note: 'Track this owned job for progress, cancellation, publication evidence and artifact references.' };
    } finally { serviceControls.releaseReservation(serviceReservation); }
  };
  const discard = request => { assertTuiWorkflowRequest('discard', request); findPlan(request); plans.delete(request.previewId); return { discarded: true }; };
  const status = async (request, { signal } = {}) => {
    assertTuiWorkflowRequest('status', request);
    const scope = requireScope(request.scopeId);
    try { await graphs.reconcile(); }
    catch (error) {
      if (!ownedCleanupIsPending(error)) throw error;
      return { scope, publications: [], graphRetirements: graphs.status(scope.id),
        note: 'Original graph resource cleanup remains pending; no publication artifacts were read.' };
    }
    if (maintenance.status()?.blocked) return { scope, maintenance: maintenance.status(), publications: [],
      note: 'Cache admission is fenced; no published/backend artifact reads were attempted.' };
    const publications = [];
    for (const repo of targets(scope)) publications.push(await observeIndexPublication(repo, loadUserConfig(repo, { env }), { signal }));
    const backendState = maintenance.status();
    return { scope, publications, maintenance: backendState?.scopeId === scope.id ? backendState : null,
      services: [...mcp.status(scope.id), ...api.status(scope.id)], indexers: indexer.status(scope.id),
      continuations: semantic.status(scope.id) };
  };
  const next = async (request, context) => { assertTuiWorkflowRequest('next', request); return semantic.next(request, context); };
  const closeContinuation = async request => {
    assertTuiWorkflowRequest('close-continuation', request); return semantic.discard(request);
  };
  const services = request => {
    assertTuiWorkflowRequest('services', request); const scope = requireScope(request.scopeId);
    return { scope, ownedServices: serviceControls.list(scope.id),
      resources: [...mcp.status(scope.id), ...api.status(scope.id), ...indexer.status(scope.id), ...graphs.status(scope.id)],
      note: 'Only exact admitted current-session jobs receive stop controls. Resource health and closure remain separate observations.' };
  };
  const stopService = async (request, { signal } = {}) => {
    assertTuiWorkflowRequest('stop-service', request); throwIfAborted(signal);
    return serviceControls.stop(request);
  };
  const reset = async () => { plans.clear(); await settleOwnedActions({ mcp: () => mcp.dispose(), api: () => api.dispose(),
    semantic: () => semantic.dispose(), indexer: () => indexer.dispose(), graphs: () => graphs.dispose() }); serviceControls.clear(); };
  return { describe, preview, launch, discard, status, services, 'stop-service': stopService, next, 'close-continuation': closeContinuation, reset,
    assertCacheAdmission: maintenance.assertAdmission, cacheMaintenanceStatus: maintenance.status,
    dispose: async () => { disposed = true; await settleOwnedActions({ maintenance: () => maintenance.dispose(), sessions: reset }); } };
};
