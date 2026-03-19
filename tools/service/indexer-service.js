#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { SERVICE_INDEXER_OPTIONS } from '../../src/shared/cli-options.js';
import { getEnvConfig } from '../../src/shared/env.js';
import { normalizeObservability } from '../../src/shared/observability.js';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import {
  resolveRepoRootArg,
  getCacheRoot,
  getRuntimeConfig,
  loadUserConfig,
  resolveRepoConfigPath,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../shared/dict-utils.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';
import { getServiceConfigPath, loadServiceConfig, resolveRepoRegistry } from './config.js';
import {
  compactQueueState,
  describeQueueBackpressure,
  ensureQueueDir,
  enqueueJob,
  claimNextJob,
  completeJob,
  loadQuarantine,
  quarantineJob,
  quarantineSummary,
  queueSummary,
  purgeQuarantinedJobs,
  retryQuarantinedJob,
  resolveQueueName,
  requeueStaleJobs,
  touchJobHeartbeat
} from './queue.js';
import { ensureRepo, resolveRepoEntry, resolveRepoPath } from './repos.js';
import { startBuildProgressMonitor } from './indexer-service/progress-monitor.js';
import { createJobCompletion } from './indexer-service/job-completion.js';
import { createJobExecutor } from './indexer-service/job-executor.js';
import { createQueueWorker } from './indexer-service/queue-worker.js';
import { resolveQueueLeasePolicy } from './lease-policy.js';
import { resolveQueueAdmissionPolicy } from './admission-policy.js';
import { resolveQueueRetentionPolicy } from './retention-policy.js';
import { resolveQueueOperationalEnvelope } from './operational-envelope.js';
import { collectEmbeddingReplayState } from './embedding-replay.js';
import {
  cleanupOrphanArtifacts,
  heartbeatStatusRepairState,
  inspectRepairState,
  purgeRepairJobs,
  quarantineRepairJob,
  retryRepairJob,
  unlockRepairState
} from './repair.js';
import {
  completeServiceShutdown,
  loadServiceShutdownState,
  requestServiceShutdown,
  resumeServiceShutdown,
  updateServiceShutdownWorker
} from './shutdown-state.js';

const argv = createCli({
  scriptName: 'indexer-service',
  options: SERVICE_INDEXER_OPTIONS
}).parse();

const command = argv.command || String(argv._[0] || '');
const configPath = getServiceConfigPath(argv.config || null);
const config = loadServiceConfig(configPath);
const envConfig = getEnvConfig();
const repoEntries = resolveRepoRegistry(config, configPath);
const baseDir = config.baseDir
  ? path.resolve(config.baseDir)
  : path.join(getCacheRoot(), 'service', 'repos');
const queueDir = config.queueDir
  ? path.resolve(config.queueDir)
  : path.join(getCacheRoot(), 'service', 'queue');
const queueName = argv.queue || 'index';
const resolvedQueueName = resolveQueueName(queueName, {
  reason: queueName === 'embeddings' ? 'embeddings' : null,
  stage: argv.stage || null,
  mode: argv.mode || null
});
const serviceExecutionModeRaw = envConfig.indexerServiceExecutionMode
  || config?.worker?.executionMode
  || 'subprocess';
const serviceExecutionMode = String(serviceExecutionModeRaw || '').trim().toLowerCase() === 'daemon'
  ? 'daemon'
  : 'subprocess';
const isEmbeddingsQueue = queueName === 'embeddings';
const monitorBuildProgress = queueName === 'index';
const queueConfig = isEmbeddingsQueue
  ? (config.embeddings?.queue || {})
  : (config.queue || {});
const workerConfig = isEmbeddingsQueue
  ? (config.embeddings?.worker || {})
  : (config.worker || {});
const daemonWorkerConfig = config.worker?.daemon && typeof config.worker.daemon === 'object'
  ? config.worker.daemon
  : {};
const queueMaxRetries = Number.isFinite(queueConfig.maxRetries) ? queueConfig.maxRetries : null;
const staleQueueMaxRetries = Number.isFinite(queueConfig.maxRetries) ? queueConfig.maxRetries : 2;
const queueAdmissionPolicy = resolveQueueAdmissionPolicy({
  queueName: resolvedQueueName || queueName,
  queueConfig,
  workerConfig
});
const queueOperationalEnvelope = resolveQueueOperationalEnvelope({
  queueName: resolvedQueueName || queueName,
  queueConfig,
  workerConfig
});
const queueRetentionPolicy = resolveQueueRetentionPolicy({
  queueName: resolvedQueueName || queueName,
  queueConfig
});
const embeddingWorkerConfig = config.embeddings?.worker || {};
const embeddingMemoryMb = Number.isFinite(Number(embeddingWorkerConfig.maxMemoryMb))
  ? Math.max(128, Math.floor(Number(embeddingWorkerConfig.maxMemoryMb)))
  : null;
const embeddingExtraEnv = embeddingMemoryMb
  ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${embeddingMemoryMb}`.trim() }
  : {};
const JOB_HEARTBEAT_INTERVAL_MS = 30000;
const shutdownTimeoutMs = Number.isFinite(Number(workerConfig.shutdownTimeoutMs))
  ? Math.max(250, Math.trunc(Number(workerConfig.shutdownTimeoutMs)))
  : 10000;
const isDryRun = argv['dry-run'] === true;
const runtimeConfigCache = new Map();
const RUNTIME_CONFIG_REVALIDATE_MS = 1000;
const RUNTIME_CONFIG_CACHE_MAX_ENTRIES = 128;

/**
 * Normalize repo cache keys to avoid duplicate cache entries for equivalent
 * paths (for example mixed-case Windows drive paths).
 *
 * @param {string} repoPath
 * @returns {string}
 */
const normalizeRuntimeConfigCacheKey = (repoPath) => {
  const resolved = path.resolve(repoPath || process.cwd());
  return process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved;
};

/**
 * Insert/update one runtime config cache entry and enforce bounded LRU size.
 *
 * @param {string} cacheKey
 * @param {object} entry
 * @returns {void}
 */
const setRuntimeConfigCacheEntry = (cacheKey, entry) => {
  if (runtimeConfigCache.has(cacheKey)) {
    runtimeConfigCache.delete(cacheKey);
  }
  runtimeConfigCache.set(cacheKey, entry);
  while (runtimeConfigCache.size > RUNTIME_CONFIG_CACHE_MAX_ENTRIES) {
    const oldestKey = runtimeConfigCache.keys().next().value;
    if (oldestKey == null) break;
    runtimeConfigCache.delete(oldestKey);
  }
};

/**
 * Read repo config modification time for runtime-config cache invalidation.
 *
 * @param {string} repoPath
 * @returns {{configPath:string,mtimeMs:number|null}}
 */
const readRepoConfigMtime = (repoPath) => {
  const configPath = resolveRepoConfigPath(repoPath, null);
  try {
    const stat = fs.statSync(configPath);
    return {
      configPath,
      mtimeMs: Number.isFinite(stat?.mtimeMs) ? stat.mtimeMs : null
    };
  } catch {
    return { configPath, mtimeMs: null };
  }
};

/**
 * Resolve repo registry entry from CLI repo argument.
 *
 * @param {string} repoArg
 * @returns {object|null}
 */
const resolveRepoEntryForArg = (repoArg) => resolveRepoEntry(repoArg, repoEntries, baseDir);

/**
 * Build a queue job id that stays sortable by enqueue time.
 *
 * @returns {string}
 */
const formatJobId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const toolRoot = resolveToolRoot();

/**
 * Print command output payload in compact or pretty JSON mode.
 *
 * @param {object} payload
 * @returns {void}
 */
const printPayload = (payload) => {
  if (argv.json) {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
};

/**
 * Emit a command error in JSON/plain mode and exit.
 *
 * @param {string} message
 * @param {{code?:number,payload?:object}} [options]
 * @returns {never}
 */
const exitWithCommandError = (message, { code = 1, payload = {} } = {}) => {
  if (argv.json) {
    const payloadObject = payload && typeof payload === 'object' ? payload : {};
    printPayload({
      ...payloadObject,
      ok: false,
      error: message
    });
  } else {
    console.error(message);
  }
  process.exit(code);
};

/**
 * Cache runtime config by resolved repo root to avoid repeated config parsing.
 *
 * @param {string} repoPath
 * @returns {object}
 */
const getCachedRuntimeConfig = (repoPath) => {
  const resolvedRepoPath = path.resolve(repoPath || process.cwd());
  const cacheKey = normalizeRuntimeConfigCacheKey(resolvedRepoPath);
  const cached = runtimeConfigCache.get(cacheKey);
  const now = Date.now();
  if (
    cached?.runtimeConfig
    && Number.isFinite(Number(cached.lastConfigCheckAtMs))
    && (now - Number(cached.lastConfigCheckAtMs)) < RUNTIME_CONFIG_REVALIDATE_MS
  ) {
    setRuntimeConfigCacheEntry(cacheKey, { ...cached, lastConfigCheckAtMs: now });
    return cached.runtimeConfig;
  }
  const { configPath, mtimeMs } = readRepoConfigMtime(resolvedRepoPath);
  if (
    cached
    && cached.configPath === configPath
    && cached.mtimeMs === mtimeMs
    && cached.runtimeConfig
  ) {
    setRuntimeConfigCacheEntry(cacheKey, {
      ...cached,
      lastConfigCheckAtMs: now
    });
    return cached.runtimeConfig;
  }
  const userConfig = loadUserConfig(resolvedRepoPath);
  const runtimeConfig = getRuntimeConfig(resolvedRepoPath, userConfig);
  setRuntimeConfigCacheEntry(cacheKey, {
    runtimeConfig,
    configPath,
    mtimeMs,
    lastConfigCheckAtMs: now
  });
  return runtimeConfig;
};

/**
 * Resolve child-process runtime env for a repo with optional env overrides.
 *
 * @param {string} repoPath
 * @param {Record<string, string>} [extraEnv={}]
 * @returns {Record<string, string>}
 */
const resolveRepoRuntimeEnv = (repoPath, extraEnv = {}) => {
  const runtimeConfig = getCachedRuntimeConfig(repoPath);
  const envCandidate = extraEnv && typeof extraEnv === 'object'
    ? { ...process.env, ...extraEnv }
    : process.env;
  return resolveRuntimeEnv(runtimeConfig, envCandidate);
};

/**
 * Emit effective UV threadpool configuration diagnostics for service startup.
 *
 * @param {string|null} repoRoot
 * @param {string} [label='indexer']
 * @returns {void}
 */
function logThreadpoolInfo(repoRoot, label = 'indexer') {
  const runtimeConfig = repoRoot ? getRuntimeConfig(repoRoot) : { uvThreadpoolSize: null };
  const effectiveUvRaw = Number(process.env.UV_THREADPOOL_SIZE);
  const effectiveUvThreadpoolSize = Number.isFinite(effectiveUvRaw) && effectiveUvRaw > 0
    ? Math.floor(effectiveUvRaw)
    : null;
  if (effectiveUvThreadpoolSize) {
    if (runtimeConfig.uvThreadpoolSize && runtimeConfig.uvThreadpoolSize !== effectiveUvThreadpoolSize) {
      console.error(`[${label}] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env overrides runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
    } else if (runtimeConfig.uvThreadpoolSize) {
      console.error(`[${label}] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize})`);
    } else {
      console.error(`[${label}] UV_THREADPOOL_SIZE=${effectiveUvThreadpoolSize} (env)`);
    }
  } else if (runtimeConfig.uvThreadpoolSize) {
    console.error(`[${label}] UV_THREADPOOL_SIZE=default (runtime.uvThreadpoolSize=${runtimeConfig.uvThreadpoolSize} not applied; start via pairofcleats CLI or set UV_THREADPOOL_SIZE before launch)`);
  }
}

/**
 * Synchronize configured repos according to service sync policy.
 *
 * @returns {Promise<void>}
 */
const handleSync = async () => {
  const targets = argv.repo ? [resolveRepoEntryForArg(argv.repo)].filter(Boolean) : repoEntries;
  if (!targets.length) {
    exitWithCommandError('No repos configured for sync.');
  }
  const policy = config.sync?.policy || 'pull';
  const results = [];
  for (const entry of targets) {
    const result = await ensureRepo(entry, baseDir, policy);
    results.push({ id: entry.id || entry.path, ...result });
  }
  const failed = results.filter((entry) => !entry?.ok);
  printPayload({ ok: failed.length === 0, results });
  if (failed.length > 0) {
    const firstSignal = failed.find((entry) => (
      typeof entry?.signal === 'string' && entry.signal.trim().length > 0
    ))?.signal || null;
    if (firstSignal) {
      // Preserve signal semantics (for example SIGINT) instead of collapsing
      // cancellations into generic non-zero exits.
      return exitLikeCommandResult({ status: null, signal: firstSignal });
    }
    process.exit(1);
  }
};

/**
 * Enqueue one index/embedding job from CLI inputs.
 *
 * @returns {Promise<void>}
 */
const handleEnqueue = async () => {
  const target = resolveRepoEntryForArg(resolveRepoRootArg(argv.repo));
  if (!target) {
    exitWithCommandError('Repo not found for enqueue.');
  }
  const shutdown = await loadServiceShutdownState(queueDir, resolvedQueueName);
  if (shutdown.accepting === false) {
    exitWithCommandError('Queue is not accepting new work.', {
      payload: {
        code: 'SERVICE_STOP_ACCEPTING',
        shutdown
      }
    });
  }
  await ensureQueueDir(queueDir);
  const id = formatJobId();
  const mode = argv.mode || 'both';
  const repoPath = resolveRepoPath(target, baseDir) || target.path;
  const observability = normalizeObservability(null, {
    surface: 'service',
    operation: 'queue_enqueue',
    context: {
      queueName: resolvedQueueName || queueName,
      jobId: id,
      repoRoot: repoPath,
      mode,
      stage: argv.stage || null
    }
  });
  const result = await enqueueJob(queueDir, {
    id,
    createdAt: new Date().toISOString(),
    repo: repoPath,
    mode,
    reason: argv.reason || null,
    stage: argv.stage || null,
    maxRetries: queueMaxRetries ?? null,
    observability
  }, queueConfig.maxQueued ?? null, queueName, {
    admissionPolicy: queueAdmissionPolicy,
    sloPolicy: queueOperationalEnvelope.slo
  });
  if (!result.ok) {
    exitWithCommandError(result.message || 'Failed to enqueue job.', {
      payload: {
        code: result.code || null,
        backpressure: result.backpressure || null
      }
    });
  }
  printPayload({
    ok: true,
    job: result.job,
    observability: result.job?.observability || null,
    duplicate: result.duplicate === true,
    replaySuppressed: result.replaySuppressed === true,
    idempotencyKey: result.idempotencyKey || result.job?.idempotencyKey || null,
    deferred: result.deferred === true,
    backpressure: result.backpressure || null
  });
};

/**
 * Emit queue summary for the resolved queue namespace.
 *
 * @returns {Promise<void>}
 */
const handleStatus = async () => {
  const summary = await queueSummary(queueDir, resolvedQueueName);
  const quarantine = await quarantineSummary(queueDir, resolvedQueueName);
  const backpressure = await describeQueueBackpressure(queueDir, resolvedQueueName, {
    admissionPolicy: queueAdmissionPolicy,
    sloPolicy: queueOperationalEnvelope.slo
  });
  const shutdown = await loadServiceShutdownState(queueDir, resolvedQueueName);
  printPayload({
    ok: true,
    queue: summary,
    quarantine,
    backpressure,
    envelope: queueOperationalEnvelope,
    shutdown,
    name: resolvedQueueName
  });
};

const requireJobArg = (action) => {
  const jobId = typeof argv.job === 'string' && argv.job.trim() ? argv.job.trim() : '';
  if (!jobId) {
    exitWithCommandError(`--job is required for ${action}.`);
  }
  return jobId;
};

const handleQuarantine = async () => {
  const quarantine = await loadQuarantine(queueDir, resolvedQueueName);
  const activeJobs = quarantine.jobs.filter((job) => (job.quarantine?.state || 'quarantined') === 'quarantined');
  if (argv.job) {
    const jobId = requireJobArg('quarantine');
    const job = quarantine.jobs.find((entry) => entry.id === jobId);
    if (!job) {
      exitWithCommandError(`Quarantined job not found: ${jobId}`);
    }
    printPayload({ ok: true, queue: resolvedQueueName, job });
    return;
  }
  printPayload({
    ok: true,
    queue: resolvedQueueName,
    summary: await quarantineSummary(queueDir, resolvedQueueName),
    jobs: activeJobs
  });
};

const handleInspect = async () => {
  const payload = await inspectRepairState(queueDir, resolvedQueueName, {
    jobId: argv.job || null
  });
  printPayload({
    ok: true,
    queue: resolvedQueueName,
    ...payload
  });
};

const handleHeartbeatStatus = async () => {
  const payload = await heartbeatStatusRepairState(queueDir, resolvedQueueName);
  printPayload(payload);
};

const handleRepairRetry = async () => {
  const jobId = requireJobArg('retry');
  const result = await retryRepairJob(queueDir, resolvedQueueName, {
    jobId,
    dryRun: isDryRun,
    requestedBy: `cli:${process.pid}`
  });
  printPayload(result);
};

const handleRepairQuarantine = async () => {
  const jobId = requireJobArg('quarantine-job');
  const result = await quarantineRepairJob(queueDir, resolvedQueueName, {
    jobId,
    reason: argv.reason || 'operator-repair',
    dryRun: isDryRun,
    requestedBy: `cli:${process.pid}`
  });
  printPayload(result);
};

const handleRepairPurge = async () => {
  const jobId = typeof argv.job === 'string' && argv.job.trim() ? argv.job.trim() : null;
  const purgeAll = argv.all === true;
  if (!jobId && !purgeAll) {
    exitWithCommandError('Provide --job <id> or --all for purge.');
  }
  const result = await purgeRepairJobs(queueDir, resolvedQueueName, {
    jobId,
    purgeAll,
    dryRun: isDryRun,
    requestedBy: `cli:${process.pid}`
  });
  printPayload(result);
};

const handleUnlock = async () => {
  const lockKind = typeof argv.lock === 'string' && argv.lock.trim()
    ? argv.lock.trim().toLowerCase()
    : 'all';
  if (!['all', 'queue', 'shutdown'].includes(lockKind)) {
    exitWithCommandError('Unlock requires --lock all|queue|shutdown.');
  }
  const result = await unlockRepairState(queueDir, resolvedQueueName, {
    lockKind,
    dryRun: isDryRun,
    requestedBy: `cli:${process.pid}`
  });
  printPayload(result);
};

const handleCleanupOrphans = async () => {
  const result = await cleanupOrphanArtifacts(queueDir, resolvedQueueName, {
    dryRun: isDryRun,
    requestedBy: `cli:${process.pid}`
  });
  printPayload(result);
};

const handleRetryQuarantined = async () => {
  const jobId = requireJobArg('retry-quarantined');
  const result = await retryRepairJob(queueDir, resolvedQueueName, {
    jobId,
    dryRun: isDryRun,
    requestedBy: `cli:${process.pid}`
  });
  printPayload(result);
};

const handlePurgeQuarantined = async () => {
  const jobId = typeof argv.job === 'string' && argv.job.trim() ? argv.job.trim() : null;
  const purgeAll = argv.all === true;
  if (!jobId && !purgeAll) {
    exitWithCommandError('Provide --job <id> or --all for purge-quarantined.');
  }
  const result = await purgeRepairJobs(queueDir, resolvedQueueName, {
    jobId,
    purgeAll,
    dryRun: isDryRun,
    requestedBy: `cli:${process.pid}`
  });
  printPayload(result);
};

const handleCompact = async () => {
  const result = await compactQueueState(queueDir, resolvedQueueName, {
    retentionPolicy: queueRetentionPolicy
  });
  printPayload(result);
};

const handleShutdown = async () => {
  const mode = argv['shutdown-mode'] || argv.reason || 'drain';
  const result = await requestServiceShutdown(queueDir, resolvedQueueName, {
    mode,
    timeoutMs: argv['timeout-ms'] ?? shutdownTimeoutMs,
    requestedBy: `cli:${process.pid}`,
    source: 'operator'
  });
  printPayload({ ok: true, shutdown: result });
};

const handleResume = async () => {
  const result = await resumeServiceShutdown(queueDir, resolvedQueueName, {
    requestedBy: `cli:${process.pid}`,
    source: 'operator'
  });
  printPayload({ ok: true, shutdown: result });
};

/**
 * Emit smoke-test metadata that callers can use to validate worker bootstrap.
 *
 * @returns {Promise<void>}
 */
const handleSmoke = async () => {
  await ensureQueueDir(queueDir);
  const summary = await queueSummary(queueDir, resolvedQueueName);
  const backpressure = await describeQueueBackpressure(queueDir, resolvedQueueName, {
    admissionPolicy: queueAdmissionPolicy,
    sloPolicy: queueOperationalEnvelope.slo
  });
  const canonicalCommand = `pairofcleats service indexer work --watch --config "${configPath}" --queue ${resolvedQueueName}`;
  const payload = {
    ok: true,
    canonicalCommand,
    configPath,
    queueDir,
    queueName: resolvedQueueName,
    queueSummary: summary,
    queueBackpressure: backpressure,
    envelope: queueOperationalEnvelope,
    shutdown: await loadServiceShutdownState(queueDir, resolvedQueueName),
    requiredEnv: ['PAIROFCLEATS_CACHE_ROOT'],
    securityDefaults: {
      allowShell: config?.security?.allowShell === true,
      allowPathEscape: config?.security?.allowPathEscape === true
    }
  };
  printPayload(payload);
};

const { completeNonRetriableFailure, finalizeJobRun } = createJobCompletion({
  queueDir,
  resolvedQueueName,
  queueMaxRetries,
  completeJob,
  quarantineJob
});

const { buildDefaultRunResult, executeClaimedJob } = createJobExecutor({
  isEmbeddingsQueue,
  serviceExecutionMode,
  daemonWorkerConfig,
  resolvedQueueName,
  embeddingExtraEnv,
  resolveRepoRuntimeEnv,
  toolRoot,
  completeNonRetriableFailure
});

const queueWorker = createQueueWorker({
  queueDir,
  resolvedQueueName,
  staleQueueMaxRetries,
  monitorBuildProgress,
  startBuildProgressMonitor,
  touchJobHeartbeat,
  requeueStaleJobs,
  claimNextJob,
  ensureQueueDir,
  executeClaimedJob,
  finalizeJobRun,
  buildDefaultRunResult,
  printPayload,
  summarizeBackpressure: async () => await describeQueueBackpressure(queueDir, resolvedQueueName, {
    admissionPolicy: queueAdmissionPolicy,
    sloPolicy: queueOperationalEnvelope.slo
  }),
  describeOperationalEnvelope: async () => queueOperationalEnvelope,
  loadJobReplayState: isEmbeddingsQueue
    ? async (job) => await collectEmbeddingReplayState(job)
    : async () => null,
  queueSummary: async () => await queueSummary(queueDir, resolvedQueueName),
  loadShutdownState: async () => await loadServiceShutdownState(queueDir, resolvedQueueName),
  requestShutdownState: async (input) => await requestServiceShutdown(queueDir, resolvedQueueName, input),
  updateShutdownWorkerState: async (patch) => await updateServiceShutdownWorker(queueDir, resolvedQueueName, patch),
  completeShutdownState: async (input) => await completeServiceShutdown(queueDir, resolvedQueueName, input),
  resolveLeasePolicy: ({ job, queueName: activeQueueName }) => resolveQueueLeasePolicy({
    job,
    queueName: activeQueueName
  }),
  jobHeartbeatIntervalMs: JOB_HEARTBEAT_INTERVAL_MS
});

/**
 * Drain queue jobs with bounded concurrency and optional watch-loop polling.
 *
 * @returns {Promise<void>}
 */
const handleWork = async () => {
  const requestedConcurrency = Number.isFinite(Number(argv.concurrency))
    ? Math.max(1, Number(argv.concurrency))
    : (workerConfig.concurrency || 1);
  const intervalMs = Number.isFinite(Number(argv.interval))
    ? Math.max(100, Number(argv.interval))
    : (config.sync?.intervalMs || 5000);
  const signalHandlers = [];
  let signalCount = 0;
  const registerSignalHandler = (signal, mode) => {
    const handler = () => {
      signalCount += 1;
      void requestServiceShutdown(queueDir, resolvedQueueName, {
        mode: signalCount > 1 ? 'force-stop' : mode,
        timeoutMs: shutdownTimeoutMs,
        requestedBy: `signal:${signal}`,
        source: 'signal'
      }).catch((err) => {
        console.error(`[indexer] failed to persist ${signal} shutdown request: ${err?.message || err}`);
      });
    };
    process.on(signal, handler);
    signalHandlers.push([signal, handler]);
  };
  registerSignalHandler('SIGTERM', 'drain');
  registerSignalHandler('SIGINT', 'cancel');
  try {
    await queueWorker.runWorkLoop({
      requestedConcurrency,
      intervalMs,
      watch: argv.watch,
      serviceExecutionMode
    });
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
  }
};

/**
 * Launch the API server subprocess with resolved runtime env.
 *
 * @returns {Promise<void>}
 */
const handleServe = async () => {
  const apiPath = path.join(toolRoot, 'tools', 'api', 'server.js');
  const repoArg = resolveRepoRootArg(argv.repo);
  logThreadpoolInfo(repoArg, 'indexer');
  const env = resolveRepoRuntimeEnv(repoArg);
  const result = await spawnSubprocess(process.execPath, [apiPath, '--repo', repoArg], {
    stdio: 'inherit',
    env,
    rejectOnNonZeroExit: false
  });
  exitLikeCommandResult({ status: result.exitCode, signal: result.signal });
};

try {
  if (command === 'sync') {
    await handleSync();
  } else if (command === 'enqueue') {
    await handleEnqueue();
  } else if (command === 'work') {
    const repoRoot = resolveRepoRootArg(argv.repo);
    logThreadpoolInfo(repoRoot, 'indexer');
    await handleWork();
  } else if (command === 'status') {
    await handleStatus();
  } else if (command === 'inspect') {
    await handleInspect();
  } else if (command === 'heartbeat-status') {
    await handleHeartbeatStatus();
  } else if (command === 'quarantine') {
    await handleQuarantine();
  } else if (command === 'quarantine-job') {
    await handleRepairQuarantine();
  } else if (command === 'retry') {
    await handleRepairRetry();
  } else if (command === 'purge') {
    await handleRepairPurge();
  } else if (command === 'retry-quarantined') {
    await handleRetryQuarantined();
  } else if (command === 'purge-quarantined') {
    await handlePurgeQuarantined();
  } else if (command === 'unlock') {
    await handleUnlock();
  } else if (command === 'cleanup-orphans') {
    await handleCleanupOrphans();
  } else if (command === 'compact') {
    await handleCompact();
  } else if (command === 'shutdown') {
    await handleShutdown();
  } else if (command === 'resume') {
    await handleResume();
  } else if (command === 'smoke') {
    await handleSmoke();
  } else if (command === 'serve') {
    await handleServe();
  } else {
    exitWithCommandError(
      'Usage: indexer-service <sync|enqueue|work|status|inspect|heartbeat-status|quarantine|quarantine-job|retry|purge|retry-quarantined|purge-quarantined|unlock|cleanup-orphans|compact|shutdown|resume|smoke|serve> [--queue index|embeddings] [--stage stage1|stage2|stage3|stage4]'
    );
  }
} catch (err) {
  exitWithCommandError(err?.message || String(err));
}
