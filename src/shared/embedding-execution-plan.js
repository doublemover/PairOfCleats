import crypto from 'node:crypto';
import path from 'node:path';
import { redactDiagnosticText } from './diagnostic-text.js';
import { stableStringify } from './stable-json.js';
import { getModelConfig } from './dict-utils.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig, resolveOnnxConfig, resolveOnnxModelPath } from './onnx-embeddings/config.js';
import { throwIfAborted } from './abort.js';
import { projectSchedulerRequestConfig } from '../index/build/runtime/scheduler.js';
import { resolveQuantizationParams } from '../storage/sqlite/quantization.js';
import { getEnvConfig } from './env/runtime.js';
import { resolveEmbeddingIntent } from './embedding-intent.js';
import { applyObservabilityContextEnv, buildChildObservability, parseObservabilityContextEnv } from './observability.js';
import { toRealPathSync } from '../workspace/identity.js';
import { snapshotEmbeddingMetadata } from './embedding-selection-snapshot.js';
import { resolveEmbeddingModelProfile, validateEmbeddingModelProfile, resolveQueryEmbeddingContract } from './embedding-model-profile.js';
import { observeStorageResource } from './storage/failure-observation.js';

export const EMBEDDING_LAUNCH_OPTION_KEYS = Object.freeze([
  'model', 'dims', 'threads', 'scheduler', 'scheduler-cpu', 'scheduler-io',
  'scheduler-mem', 'scheduler-starvation', 'scheduler-low-resource', 'stub-embeddings'
]);
const ENV_FIELDS = {
  PAIROFCLEATS_EMBEDDINGS: 'embeddings', PAIROFCLEATS_THREADS: 'threads',
  PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES: 'embeddingsSampleFiles', PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED: 'embeddingsSampleSeed',
  PAIROFCLEATS_SCHEDULER: 'schedulerEnabled', PAIROFCLEATS_SCHEDULER_CPU: 'schedulerCpuTokens',
  PAIROFCLEATS_SCHEDULER_IO: 'schedulerIoTokens', PAIROFCLEATS_SCHEDULER_MEM: 'schedulerMemoryTokens',
  PAIROFCLEATS_SCHEDULER_ADAPTIVE: 'schedulerAdaptive', PAIROFCLEATS_SCHEDULER_MAX_CPU: 'schedulerMaxCpuTokens',
  PAIROFCLEATS_SCHEDULER_MAX_IO: 'schedulerMaxIoTokens', PAIROFCLEATS_SCHEDULER_MAX_MEM: 'schedulerMaxMemoryTokens',
  PAIROFCLEATS_SCHEDULER_LOW_RESOURCE: 'schedulerLowResource', PAIROFCLEATS_SCHEDULER_TARGET_UTILIZATION: 'schedulerTargetUtilization',
  PAIROFCLEATS_SCHEDULER_UTILIZATION_ALERT_TARGET: 'schedulerUtilizationAlertTarget',
  PAIROFCLEATS_SCHEDULER_UTILIZATION_ALERT_WINDOW_MS: 'schedulerUtilizationAlertWindowMs',
  PAIROFCLEATS_SCHEDULER_ADAPTIVE_STEP: 'schedulerAdaptiveStep', PAIROFCLEATS_SCHEDULER_MEMORY_RESERVE_MB: 'schedulerMemoryReserveMb',
  PAIROFCLEATS_SCHEDULER_MEMORY_PER_TOKEN_MB: 'schedulerMemoryPerTokenMb', PAIROFCLEATS_SCHEDULER_STARVATION_MS: 'schedulerStarvationMs'
};
const ENV_KEYS = Object.keys(ENV_FIELDS);
const projectEnvironment = rawEnv => {
  const normalized = getEnvConfig(Object.fromEntries(Object.entries(rawEnv).filter(([, value]) => value != null)));
  return Object.fromEntries(Object.entries(ENV_FIELDS).map(([key, field]) => {
    const value = normalized[field];
    if (field === 'embeddings') {
      const mode = String(value || '').trim().toLowerCase();
      return [key, ['off', 'false', '0', 'disabled', 'none', 'stub'].includes(mode) ? mode : null];
    }
    if (field === 'embeddingsSampleSeed') return [key, typeof value === 'string' && value ? value : null];
    return [key, typeof value === 'boolean' ? (value ? '1' : '0') : Number.isFinite(value) ? String(value) : null];
  }));
};
const projectSourceFacts = source => {
  if (!source || !Array.isArray(source.files)) return source;
  return { ...source, files: source.files.map(file => {
    if (file?.readState !== 'missing' || file.exists !== false
      || file.errorCode !== 'ENOENT' || file.contentHash !== null) return file;
    const { readState: ignoredReadState, ...facts } = file;
    return facts;
  }) };
};
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const fail = message => Object.assign(new Error(`Invalid embedding execution plan: ${message}`), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
const digest = plan => {
  const { digest: ignoredDigest, selectedAt: ignoredTime, ...semantic } = plan;
  return crypto.createHash('sha256').update(stableStringify(semantic)).digest('hex');
};
const preflightSelections = new WeakMap();
const rejectedPreflights = new WeakMap();

/** Actual read-only admission failures retain their original selected request.
 * This is diagnostic identity, never an execution or resource-release grant.
 */
export const readEmbeddingPreflightRejection = error => rejectedPreflights.get(error) || null;

/** Freeze existing resolver outputs; never serialize raw user config or environment. */
export const createEmbeddingExecutionPlan = ({ root, indexRoot = null, buildId = null, modes, modelId = null, argv = {}, userConfig = {}, rawEnv = process.env, intent = null }) => {
  userConfig ||= {};
  const configured = userConfig.indexing?.embeddings || {};
  const model = getModelConfig(root, userConfig);
  const selected = intent || resolveEmbeddingIntent({ argv, embeddingsConfig: configured, envConfig: getEnvConfig(rawEnv) });
  const onnx = resolveOnnxConfig(configured.onnx || {}, rawEnv);
  // Prewarm text is not a model-space decision and can contain private input.
  delete onnx.prewarmTexts;
  const embeddings = {
    ...Object.fromEntries(['concurrency', 'fileParallelism', 'maxBatchTokens', 'binaryDenseVectors', 'sampleFiles', 'sampleSeed', 'crossFileChunkDedupe'].map(key => [key, configured[key] ?? null])),
    enabled: selected.embeddingEnabled,
    mode: selected.resolvedEmbeddingMode || (selected.useStubEmbeddings ? 'stub' : 'inline'),
    model: modelId || argv.model || model.id,
    provider: normalizeEmbeddingProvider(configured.provider, { strict: true }),
    normalize: configured.normalize !== false,
    quantization: resolveQuantizationParams(configured.quantization),
    onnx,
    embeddinggemma2: pick(configured.embeddinggemma2, ['revision', 'dtype', 'dimensions'])
  };
  if (selected.embeddingEnabled && !selected.useStubEmbeddings) {
    const profile = resolveEmbeddingModelProfile(embeddings.model, embeddings.embeddinggemma2);
    validateEmbeddingModelProfile(profile, { provider: embeddings.provider, normalize: embeddings.normalize });
    if (profile) embeddings.embeddinggemma2 = pick(profile, ['revision', 'dtype', 'dimensions']);
    resolveQueryEmbeddingContract({ modelId: embeddings.model, modelProfile: embeddings.embeddinggemma2,
      dims: argv.dims ?? null, useStub: false });
  }
  const plan = {
    version: 2,
    selectedAt: new Date().toISOString(),
    buildId,
    repoRoot: toRealPathSync(root),
    indexRoot: indexRoot ? toRealPathSync(indexRoot) : null,
    modes: [...new Set(modes || ['code'])].sort(),
    options: { ...pick(argv, EMBEDDING_LAUNCH_OPTION_KEYS), model: embeddings.model,
      'stub-embeddings': selected.useStubEmbeddings === true },
    embeddings,
    modelsDir: model.dir || null,
    resourcePolicy: 'pinned-request-host-admission-and-autotune-at-execution',
    resources: { threads: userConfig.threads ?? null,
      indexing: Object.fromEntries(['concurrency', 'importConcurrency', 'ioConcurrencyCap', 'embeddingBatchSize'].map(key => [key, userConfig.indexing?.[key] ?? null])),
      scheduler: projectSchedulerRequestConfig(userConfig.runtime?.scheduler, userConfig.indexing?.scheduler) },
    environment: projectEnvironment(rawEnv),
    sources: { config: projectSourceFacts(intent?.configSources) || null, model: argv.model ? 'cli.model' : configured.model ? 'config.indexing.embeddings.model'
      : userConfig.models?.id ? 'config.models.id' : 'default', intent: selected.reason || 'resolved-parent' }
  };
  const planText = JSON.stringify(plan);
  if (redactDiagnosticText(planText, planText.length + 1) !== planText) throw fail('contains credential-bearing text');
  if (Buffer.byteLength(planText) > 32768) throw fail('exceeds the 32 KiB handoff budget');
  plan.digest = digest(plan);
  return validateEmbeddingExecutionPlan(plan);
};

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const record = (value, allowed, label) => {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail(`unsupported ${label} fields`);
};
const equalProjection = (value, projected, label) => {
  if (stableStringify(value) !== stableStringify(projected)) throw fail(`noncanonical ${label}`);
};
const text = value => typeof value === 'string';
const boolean = value => typeof value === 'boolean';
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const nullable = predicate => value => value === null || predicate(value);
const fields = (value, shape, label) => {
  record(value, Object.keys(shape), label);
  for (const [key, check] of Object.entries(shape)) {
    if (!check(value[key])) throw fail(`invalid ${label}.${key}`);
  }
};
const validateSourceFacts = source => {
  if (source === null) return;
  fields(source, { version: value => value === 1, files: Array.isArray, repoTrusted: boolean,
    discardedAuthorityPaths: value => Array.isArray(value) && value.every(text),
    trustedMerge: boolean, testOverlay: isRecord }, 'source facts');
  fields(source.testOverlay, { applied: boolean, source: value => value === 'test-environment' }, 'test origin');
  for (const file of source.files) {
    record(file, ['path', 'source', 'exists', 'contentHash', 'errorCode', 'contentHashOmitted'], 'source file');
    if (!text(file.path) || !['repository', 'trusted-external'].includes(file.source) || !boolean(file.exists)
      || !(file.contentHash === null || /^[a-f0-9]{64}$/.test(file.contentHash))
      || (file.errorCode !== undefined && !/^[A-Z0-9_]+$/.test(file.errorCode))
      || (file.contentHashOmitted !== undefined && file.contentHashOmitted !== 'sensitive-source')) throw fail('invalid source file');
  }
};
const validatePlan = (plan, { root, indexRoot = null, modes = null } = {}) => {
  const allowed = ['version', 'selectedAt', 'buildId', 'repoRoot', 'indexRoot', 'modes', 'options', 'embeddings', 'modelsDir', 'resourcePolicy', 'resources', 'environment', 'sources', 'digest'];
  record(plan, allowed, 'plan');
  const serialized = JSON.stringify(plan);
  if (plan.version !== 2 || typeof plan.digest !== 'string'
    || Buffer.byteLength(serialized) > 32768 || plan.digest !== digest(plan)) throw fail('version, size or digest mismatch');
  if (redactDiagnosticText(serialized, serialized.length + 1) !== serialized) throw fail('contains credential-bearing text');
  if (!text(plan.selectedAt) || !Number.isFinite(Date.parse(plan.selectedAt))) throw fail('invalid selection time');
  if (plan.buildId !== null && (typeof plan.buildId !== 'string' || !plan.buildId || plan.buildId.length > 256)) throw fail('invalid build identity');
  if (typeof plan.repoRoot !== 'string' || !path.isAbsolute(plan.repoRoot) || (plan.indexRoot !== null && (typeof plan.indexRoot !== 'string' || !path.isAbsolute(plan.indexRoot)))) throw fail('roots must be absolute');
  if (root && toRealPathSync(plan.repoRoot) !== toRealPathSync(root)) throw fail('repository root mismatch');
  if (indexRoot && toRealPathSync(plan.indexRoot) !== toRealPathSync(indexRoot)) throw fail('pinned index root mismatch');
  if (!Array.isArray(plan.modes) || !plan.modes.length || plan.modes.some(mode => !['code', 'prose', 'extracted-prose', 'records'].includes(mode))) throw fail('invalid modes');
  if (modes?.some(mode => !plan.modes.includes(mode))) throw fail('mode mismatch');
  record(plan.options, EMBEDDING_LAUNCH_OPTION_KEYS, 'options');
  for (const [key, value] of Object.entries(plan.options)) {
    const check = key === 'model' ? text : ['scheduler', 'scheduler-low-resource', 'stub-embeddings'].includes(key) ? boolean : numeric;
    if (!check(value)) throw fail(`invalid option ${key}`);
  }
  fields(plan.embeddings, {
    concurrency: nullable(numeric), fileParallelism: nullable(numeric), maxBatchTokens: nullable(numeric),
    binaryDenseVectors: nullable(boolean), sampleFiles: nullable(numeric), sampleSeed: nullable(text),
    crossFileChunkDedupe: nullable(boolean), enabled: boolean, mode: value => ['off', 'inline', 'stub', 'service'].includes(value),
    model: value => text(value) && value.length > 0, provider: value => ['onnx', 'xenova', 'embeddinggemma2'].includes(value),
    normalize: boolean, quantization: isRecord, onnx: isRecord, embeddinggemma2: isRecord
  }, 'embeddings');
  fields(plan.embeddings.quantization, { minVal: numeric, maxVal: numeric, levels: numeric }, 'quantization');
  equalProjection(plan.embeddings.quantization, resolveQuantizationParams(plan.embeddings.quantization), 'quantization');
  // Canonical ONNX settings are resolved at submission and transported as values.
  // Execution consumes this shape without applying its ambient environment.
  fields(plan.embeddings.onnx, {
    modelPath: text, tokenizerId: text, executionProviders: nullable(value => Array.isArray(value) && value.every(text)),
    intraOpNumThreads: nullable(numeric), interOpNumThreads: nullable(numeric), graphOptimizationLevel: nullable(text),
    cpuExecutionProviderTuning: boolean, tokenizationCacheEnabled: boolean, tokenizationCacheMaxEntries: numeric,
    prewarmTokenizer: boolean, prewarmModel: boolean
  }, 'onnx');
  const canonicalOnnx = normalizeOnnxConfig(plan.embeddings.onnx);
  delete canonicalOnnx.prewarmTexts;
  equalProjection(plan.embeddings.onnx, canonicalOnnx, 'onnx');
  record(plan.embeddings.embeddinggemma2, ['revision', 'dtype', 'dimensions'], 'embeddinggemma2');
  for (const [key, value] of Object.entries(plan.embeddings.embeddinggemma2)) {
    if (!(key === 'dimensions' ? numeric(value) : text(value))) throw fail(`invalid embeddinggemma2.${key}`);
  }
  if (plan.options.model !== plan.embeddings.model) throw fail('model option mismatch');
  if (!nullable(text)(plan.modelsDir) || plan.resourcePolicy !== 'pinned-request-host-admission-and-autotune-at-execution') throw fail('invalid resource policy or models directory');
  fields(plan.resources, { threads: nullable(numeric), indexing: isRecord, scheduler: isRecord }, 'resources');
  fields(plan.resources.indexing, { concurrency: nullable(numeric), importConcurrency: nullable(numeric),
    ioConcurrencyCap: nullable(numeric), embeddingBatchSize: nullable(numeric) }, 'indexing resources');
  equalProjection(plan.resources.scheduler, projectSchedulerRequestConfig(null, plan.resources.scheduler), 'scheduler');
  record(plan.environment, ENV_KEYS, 'environment');
  equalProjection(plan.environment, projectEnvironment(plan.environment), 'environment');
  fields(plan.sources, { config: value => value === null || isRecord(value),
    model: value => ['cli.model', 'config.indexing.embeddings.model', 'config.models.id', 'default'].includes(value),
    intent: value => ['default', 'environment-off', 'configuration-off', 'policy-off', 'environment-stub', 'cli-stub',
      'automatic-inline', 'configuration-mode', 'service-worker-inline', 'resolved-parent', 'resolved-runtime'].includes(value)
  }, 'sources');
  validateSourceFacts(plan.sources.config);
  return plan;
};

/** Reject unknown nested authority even when a caller recomputes the unkeyed digest. */
export const validateEmbeddingExecutionPlan = (plan, selection) => {
  try { return validatePlan(plan, selection); }
  catch (error) {
    if (error?.code === 'ERR_EMBEDDING_EXECUTION_PLAN') throw error;
    throw fail('malformed handoff value');
  }
};

/** A bounded immutable selection can outlive Stage2 without borrowing caller data. */
export const captureEmbeddingExecutionPlan = (plan, selection) =>
  snapshotEmbeddingMetadata(validateEmbeddingExecutionPlan(plan, selection));

/** Read-only admission of the selected local graph, without loading a provider. */
export const preflightEmbeddingExecutionPlan = (plan, { executionHost = 'local', signal = null } = {}) => {
  if (!['local', 'deferred'].includes(executionHost)) throw fail('invalid preflight execution host');
  throwIfAborted(signal);
  const selected = captureEmbeddingExecutionPlan(plan);
  const receipt = (status, reason, observedPlan = selected) => {
    const evidence = Object.freeze({ version: 1, status, reason,
      executionHost, runtime: 'unverified', inference: 'unverified', downloadAttempted: false });
    preflightSelections.set(evidence, { digest: observedPlan.digest, selectedAt: observedPlan.selectedAt });
    return evidence;
  };
  const result = (status, reason) => Object.freeze({ plan: selected, preflight: receipt(status, reason) });
  if (!selected.embeddings.enabled || selected.embeddings.mode === 'off') return result('inactive', 'embeddings-off');
  if (selected.options['stub-embeddings']) return result('inactive', 'stub-does-not-use-model-assets');
  if (executionHost === 'deferred' || selected.embeddings.mode === 'service') return result('unverified', 'execution-host-deferred');
  // Fetch-capable providers retain their existing acquisition/runtime owner. A
  // parent-host file observation cannot qualify that owner or a cache-only hit.
  if (selected.embeddings.provider !== 'onnx') return result('unverified', 'provider-acquisition-at-execution');
  let graph;
  try {
    graph = resolveOnnxModelPath({ rootDir: selected.repoRoot,
      modelPath: selected.embeddings.onnx.modelPath, modelsDir: selected.modelsDir,
      modelId: selected.embeddings.model });
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'embedding-preflight-rejection' });
    observation.requireSettled();
    rejectedPreflights.set(observation.primary, Object.freeze({ plan: selected,
      preflight: receipt('unavailable', 'selected-graph-observation-failed') }));
    throw observation.primary;
  }
  throwIfAborted(signal);
  if (!graph) {
    const preflight = receipt('unavailable', 'local-onnx-graph-unavailable');
    const error = Object.assign(new Error('The requested local ONNX graph is unavailable. Download/verify the selected model or run explicit Stage2 without embeddings.'), {
      code: 'ERR_EMBEDDING_PREFLIGHT', preflight
    });
    rejectedPreflights.set(error, Object.freeze({ plan: selected, preflight }));
    throw error;
  }
  // Complete graph selection before CPU work. A later default/selector change
  // must not silently choose a different graph; runtime still verifies bytes.
  const pinned = structuredClone(selected);
  pinned.embeddings.onnx.modelPath = path.resolve(graph);
  pinned.digest = digest(pinned);
  const pinnedPlan = captureEmbeddingExecutionPlan(pinned);
  return Object.freeze({ plan: pinnedPlan,
    preflight: receipt('ready-to-attempt', 'selected-graph-readable', pinnedPlan) });
};

/** Bounded diagnostic evidence for the existing attempt owner, never a launch
 * plan or readiness grant. Hash selected environment/resources without storing
 * their raw containers or bypassing runtime-receipt redaction.
 */
export const projectEmbeddingExecutionEvidence = ({ plan, preflight }, selection) => {
  const selected = captureEmbeddingExecutionPlan(plan, selection);
  const observed = preflightSelections.get(preflight);
  if (!observed || observed.digest !== selected.digest || observed.selectedAt !== selected.selectedAt) {
    throw fail('preflight evidence does not belong to the selected plan');
  }
  fields(preflight, { version: value => value === 1,
    status: value => ['inactive', 'unverified', 'ready-to-attempt', 'unavailable'].includes(value),
    reason: value => ['embeddings-off', 'stub-does-not-use-model-assets', 'execution-host-deferred',
      'provider-acquisition-at-execution', 'selected-graph-readable', 'local-onnx-graph-unavailable',
      'selected-graph-observation-failed'].includes(value),
    executionHost: value => ['local', 'deferred'].includes(value), runtime: value => value === 'unverified',
    inference: value => value === 'unverified', downloadAttempted: value => value === false }, 'preflight evidence');
  const hash = value => crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
  return snapshotEmbeddingMetadata({ version: 1, projection: 'diagnostic-selection-summary',
    planDigest: selected.digest, selectedAt: selected.selectedAt,
    requested: { modelId: redactDiagnosticText(selected.embeddings.model, 512), provider: selected.embeddings.provider,
      mode: selected.embeddings.mode, enabled: selected.embeddings.enabled,
      stub: selected.options['stub-embeddings'], dims: selected.options.dims ?? null, normalize: selected.embeddings.normalize,
      selectedGraph: redactDiagnosticText(selected.embeddings.onnx.modelPath, 1024) },
    resourceRequestDigest: hash(selected.resources), environmentSelectionDigest: hash(selected.environment),
    profileDigest: hash(selected.embeddings.embeddinggemma2), preflight });
};

/** Bind generated execution scope only. Never re-run model/config/env selection. */
export const bindEmbeddingExecutionPlan = (plan, binding = {}) => {
  record(binding, ['root', 'indexRoot', 'buildId', 'modes'], 'binding');
  for (const key of ['root', 'indexRoot']) if (binding[key] != null
    && (typeof binding[key] !== 'string' || !path.isAbsolute(binding[key]))) throw fail(`binding ${key} must be absolute`);
  validateEmbeddingExecutionPlan(plan, { root: binding.root });
  const indexRoot = binding.indexRoot ? toRealPathSync(binding.indexRoot) : plan.indexRoot;
  const buildId = binding.buildId ?? plan.buildId;
  if (plan.indexRoot && indexRoot !== toRealPathSync(plan.indexRoot)) throw fail('cannot rebind selected index root');
  if (plan.buildId && buildId !== plan.buildId) throw fail('cannot rebind selected build identity');
  const modes = binding.modes == null ? plan.modes : binding.modes;
  if (!Array.isArray(modes) || !modes.length || modes.some(mode => !plan.modes.includes(mode))) throw fail('binding cannot widen selected modes');
  const bound = { ...structuredClone(plan), indexRoot, buildId, modes: [...new Set(modes)].sort() };
  bound.digest = digest(bound);
  return captureEmbeddingExecutionPlan(bound, { root: binding.root, indexRoot, modes });
};

export const buildEmbeddingLaunchArgs = (options = {}) => {
  const args = [];
  for (const key of EMBEDDING_LAUNCH_OPTION_KEYS) {
    const value = options[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') args.push(value ? `--${key}` : `--no-${key}`);
    else args.push(`--${key}`, String(value));
  }
  return args;
};

export const attachEmbeddingExecutionPlan = (env, plan, observability = null) => {
  validateEmbeddingExecutionPlan(plan);
  const child = buildChildObservability(observability || parseObservabilityContextEnv(env), {
    surface: 'build', operation: 'build_embeddings', phase: 'stage3',
    context: { embeddingPlanRequired: true, embeddingPlan: plan }
  });
  const result = { ...env };
  delete result.PAIROFCLEATS_CACHE_REBUILD;
  return applyObservabilityContextEnv(result, child);
};

export const readEmbeddingExecutionPlan = (env, selection) => {
  const observability = parseObservabilityContextEnv(env);
  if (env.PAIROFCLEATS_OBSERVABILITY_CONTEXT && !observability) throw fail('malformed parent context');
  const plan = observability?.context?.embeddingPlan;
  if (!plan) {
    if (observability?.context?.embeddingPlanRequired) throw fail('missing required plan');
    return null;
  }
  return validateEmbeddingExecutionPlan(plan, selection);
};

export const applyEmbeddingExecutionPlan = (plan, userConfig, rawEnv) => {
  validateEmbeddingExecutionPlan(plan);
  const env = { ...rawEnv };
  for (const [key, value] of Object.entries(plan.environment)) {
    if (value === null) delete env[key];
    else env[key] = String(value);
  }
  return {
    rawEnv: env,
    userConfig: {
      ...userConfig,
      models: { ...userConfig.models, dir: plan.modelsDir },
      threads: plan.resources.threads,
      runtime: { ...userConfig.runtime, scheduler: {} },
      indexing: { ...userConfig.indexing, ...plan.resources.indexing,
        scheduler: plan.resources.scheduler, embeddings: { ...userConfig.indexing?.embeddings, ...plan.embeddings } }
    }
  };
};
