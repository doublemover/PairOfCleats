#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { SERVICE_INDEXER_OPTIONS } from '../../src/shared/cli-options.js';
import { getEnvConfig } from '../../src/shared/env.js';
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
  ensureQueueDir,
  enqueueJob,
  claimNextJob,
  completeJob,
  queueSummary,
  resolveQueueName,
  requeueStaleJobs,
  touchJobHeartbeat
} from './queue.js';
import { ensureRepo, resolveRepoEntry, resolveRepoPath } from './repos.js';
import { startBuildProgressMonitor } from './indexer-service/progress-monitor.js';
import { createJobCompletion } from './indexer-service/job-completion.js';
import { createJobExecutor } from './indexer-service/job-executor.js';
import { createQueueWorker } from './indexer-service/queue-worker.js';

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
const embeddingWorkerConfig = config.embeddings?.worker || {};
const embeddingMemoryMb = Number.isFinite(Number(embeddingWorkerConfig.maxMemoryMb))
  ? Math.max(128, Math.floor(Number(embeddingWorkerConfig.maxMemoryMb)))
  : null;
const embeddingExtraEnv = embeddingMemoryMb
  ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${embeddingMemoryMb}`.trim() }
  : {};
const JOB_HEARTBEAT_INTERVAL_MS = 30000;
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
  await ensureQueueDir(queueDir);
  const id = formatJobId();
  const mode = argv.mode || 'both';
  const result = await enqueueJob(queueDir, {
    id,
    createdAt: new Date().toISOString(),
    repo: resolveRepoPath(target, baseDir) || target.path,
    mode,
    reason: argv.reason || null,
    stage: argv.stage || null,
    maxRetries: queueMaxRetries ?? null
  }, queueConfig.maxQueued ?? null, queueName);
  if (!result.ok) {
    exitWithCommandError(result.message || 'Failed to enqueue job.');
  }
  printPayload({ ok: true, job: result.job });
};

/**
 * Emit queue summary for the resolved queue namespace.
 *
 * @returns {Promise<void>}
 */
const handleStatus = async () => {
  const summary = await queueSummary(queueDir, resolvedQueueName);
  printPayload({ ok: true, queue: summary, name: resolvedQueueName });
};

/**
 * Emit smoke-test metadata that callers can use to validate worker bootstrap.
 *
 * @returns {Promise<void>}
 */
const handleSmoke = async () => {
  await ensureQueueDir(queueDir);
  const summary = await queueSummary(queueDir, resolvedQueueName);
  const canonicalCommand = `pairofcleats service indexer work --watch --config "${configPath}" --queue ${resolvedQueueName}`;
  const payload = {
    ok: true,
    canonicalCommand,
    configPath,
    queueDir,
    queueName: resolvedQueueName,
    queueSummary: summary,
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
  completeJob
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
  await queueWorker.runWorkLoop({
    requestedConcurrency,
    intervalMs,
    watch: argv.watch,
    serviceExecutionMode
  });
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
  } else if (command === 'smoke') {
    await handleSmoke();
  } else if (command === 'serve') {
    await handleServe();
  } else {
    exitWithCommandError(
      'Usage: indexer-service <sync|enqueue|work|status|smoke|serve> [--queue index|embeddings] [--stage stage1|stage2|stage3|stage4]'
    );
  }
} catch (err) {
  exitWithCommandError(err?.message || String(err));
}
