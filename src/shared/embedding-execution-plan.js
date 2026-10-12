import crypto from 'node:crypto';
import path from 'node:path';
import { redactDiagnosticText } from './diagnostic-text.js';
import { stableStringify } from './stable-json.js';
import { getModelConfig } from './dict-utils.js';
import { normalizeEmbeddingProvider, normalizeOnnxConfig } from './onnx-embeddings.js';
import { projectSchedulerRequestConfig } from '../index/build/runtime/scheduler.js';
import { resolveQuantizationParams } from '../storage/sqlite/quantization.js';
import { getEnvConfig } from './env/runtime.js';
import { resolveEmbeddingIntent } from './embedding-intent.js';
import { applyObservabilityContextEnv, buildChildObservability, parseObservabilityContextEnv } from './observability.js';

export const EMBEDDING_LAUNCH_OPTION_KEYS = Object.freeze([
  'model', 'dims', 'threads', 'scheduler', 'scheduler-cpu', 'scheduler-io',
  'scheduler-mem', 'scheduler-starvation', 'scheduler-low-resource', 'stub-embeddings'
]);
const ENV_KEYS = ['PAIROFCLEATS_EMBEDDINGS', 'PAIROFCLEATS_THREADS', 'PAIROFCLEATS_EMBEDDINGS_SAMPLE_FILES', 'PAIROFCLEATS_EMBEDDINGS_SAMPLE_SEED', 'PAIROFCLEATS_SCHEDULER',
  'PAIROFCLEATS_SCHEDULER_CPU', 'PAIROFCLEATS_SCHEDULER_IO', 'PAIROFCLEATS_SCHEDULER_MEM',
  'PAIROFCLEATS_SCHEDULER_ADAPTIVE', 'PAIROFCLEATS_SCHEDULER_MAX_CPU', 'PAIROFCLEATS_SCHEDULER_MAX_IO',
  'PAIROFCLEATS_SCHEDULER_MAX_MEM', 'PAIROFCLEATS_SCHEDULER_LOW_RESOURCE',
  'PAIROFCLEATS_SCHEDULER_TARGET_UTILIZATION', 'PAIROFCLEATS_SCHEDULER_UTILIZATION_ALERT_TARGET',
  'PAIROFCLEATS_SCHEDULER_UTILIZATION_ALERT_WINDOW_MS', 'PAIROFCLEATS_SCHEDULER_ADAPTIVE_STEP',
  'PAIROFCLEATS_SCHEDULER_MEMORY_RESERVE_MB', 'PAIROFCLEATS_SCHEDULER_MEMORY_PER_TOKEN_MB',
  'PAIROFCLEATS_SCHEDULER_STARVATION_MS'];
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const fail = message => Object.assign(new Error(`Invalid embedding execution plan: ${message}`), { code: 'ERR_EMBEDDING_EXECUTION_PLAN' });
const digest = plan => {
  const { digest: ignoredDigest, selectedAt: ignoredTime, ...semantic } = plan;
  return crypto.createHash('sha256').update(stableStringify(semantic)).digest('hex');
};

/** Freeze existing resolver outputs; never serialize raw user config or environment. */
export const createEmbeddingExecutionPlan = ({ root, indexRoot = null, buildId = null, modes, argv = {}, userConfig = {}, rawEnv = process.env, intent = null }) => {
  userConfig ||= {};
  const configured = userConfig.indexing?.embeddings || {};
  const model = getModelConfig(root, userConfig);
  const selected = intent || resolveEmbeddingIntent({ argv, embeddingsConfig: configured, envConfig: getEnvConfig(rawEnv) });
  const onnx = normalizeOnnxConfig(configured.onnx || {});
  // Prewarm text is not a model-space decision and can contain private input.
  delete onnx.prewarmTexts;
  const embeddings = {
    ...Object.fromEntries(['concurrency', 'fileParallelism', 'maxBatchTokens', 'binaryDenseVectors', 'sampleFiles', 'sampleSeed', 'crossFileChunkDedupe'].map(key => [key, configured[key] ?? null])),
    enabled: selected.embeddingEnabled,
    mode: selected.resolvedEmbeddingMode || (selected.useStubEmbeddings ? 'stub' : 'inline'),
    model: argv.model || model.id,
    provider: normalizeEmbeddingProvider(configured.provider, { strict: true }),
    normalize: configured.normalize !== false,
    quantization: resolveQuantizationParams(configured.quantization),
    onnx,
    embeddinggemma2: pick(configured.embeddinggemma2, ['revision', 'dtype', 'dimensions'])
  };
  const plan = {
    version: 1,
    selectedAt: new Date().toISOString(),
    buildId,
    repoRoot: path.resolve(root),
    indexRoot: indexRoot ? path.resolve(indexRoot) : null,
    modes: [...new Set(modes || ['code'])].sort(),
    options: { ...pick(argv, EMBEDDING_LAUNCH_OPTION_KEYS), model: embeddings.model,
      'stub-embeddings': selected.useStubEmbeddings },
    embeddings,
    modelsDir: model.dir || null,
    resourcePolicy: 'pinned-request-host-admission-and-autotune-at-execution',
    resources: { threads: userConfig.threads ?? null,
      indexing: Object.fromEntries(['concurrency', 'importConcurrency', 'ioConcurrencyCap', 'embeddingBatchSize'].map(key => [key, userConfig.indexing?.[key] ?? null])),
      scheduler: projectSchedulerRequestConfig(userConfig.runtime?.scheduler, userConfig.indexing?.scheduler) },
    environment: Object.fromEntries(ENV_KEYS.map(key => [key, rawEnv[key] ?? null])),
    sources: { config: intent?.configSources || null, model: argv.model ? 'cli.model' : configured.model ? 'config.indexing.embeddings.model'
      : userConfig.models?.id ? 'config.models.id' : 'default', intent: selected.reason || 'resolved-parent' }
  };
  const planText = JSON.stringify(plan);
  if (redactDiagnosticText(planText, planText.length + 1) !== planText) throw fail('contains credential-bearing text');
  if (Buffer.byteLength(planText) > 32768) throw fail('exceeds the 32 KiB handoff budget');
  plan.digest = digest(plan);
  return plan;
};

export const validateEmbeddingExecutionPlan = (plan, { root, indexRoot = null, modes = null } = {}) => {
  const allowed = ['version', 'selectedAt', 'buildId', 'repoRoot', 'indexRoot', 'modes', 'options', 'embeddings', 'modelsDir', 'resourcePolicy', 'resources', 'environment', 'sources', 'digest'];
  if (!plan || Object.keys(plan).some(key => !allowed.includes(key)) || plan.version !== 1 || typeof plan.digest !== 'string'
    || Buffer.byteLength(JSON.stringify(plan)) > 32768 || plan.digest !== digest(plan)) throw fail('version, size or digest mismatch');
  if (plan.buildId !== null && (typeof plan.buildId !== 'string' || !plan.buildId || plan.buildId.length > 256)) throw fail('invalid build identity');
  if (typeof plan.repoRoot !== 'string' || !path.isAbsolute(plan.repoRoot) || (plan.indexRoot !== null && (typeof plan.indexRoot !== 'string' || !path.isAbsolute(plan.indexRoot)))) throw fail('roots must be absolute');
  if (root && plan.repoRoot !== path.resolve(root)) throw fail('repository root mismatch');
  if (indexRoot && plan.indexRoot !== path.resolve(indexRoot)) throw fail('pinned index root mismatch');
  if (!Array.isArray(plan.modes) || !plan.modes.length || plan.modes.some(mode => !['code', 'prose', 'extracted-prose', 'records'].includes(mode))) throw fail('invalid modes');
  if (modes?.some(mode => !plan.modes.includes(mode))) throw fail('mode mismatch');
  if (!plan.embeddings || !plan.options || !plan.resources || !plan.environment
    || Object.keys(plan.options).some(key => !EMBEDDING_LAUNCH_OPTION_KEYS.includes(key))
    || Object.keys(plan.environment).some(key => !ENV_KEYS.includes(key))) throw fail('unsupported handoff fields');
  return plan;
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
