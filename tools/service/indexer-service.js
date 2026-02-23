#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { SERVICE_INDEXER_OPTIONS } from '../../src/shared/cli-options.js';
import { parseBuildArgs } from '../../src/index/build/args.js';
import { buildIndex } from '../../src/integrations/core/index.js';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import { formatDurationMs } from '../../src/shared/time-format.js';
import { setProgressHandlers } from '../../src/shared/progress.js';
import { getEnvConfig } from '../../src/shared/env.js';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { createLifecycleRegistry } from '../../src/shared/lifecycle/registry.js';
import {
  resolveRepoRootArg,
  getCacheRoot,
  getRepoCacheRoot,
  getRuntimeConfig,
  loadUserConfig,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../shared/dict-utils.js';
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
import { buildEmbeddingsArgs, normalizeEmbeddingJob } from './indexer-service-helpers.js';
import { runLoggedSubprocess } from './subprocess-log.js';

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

const printPayload = (payload) => {
  if (argv.json) {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
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


const BUILD_STATE_FILE = 'build_state.json';
const BUILD_STATE_POLL_MS = 5000;
const BUILD_STATE_LOOKBACK_MS = 5 * 60 * 1000;

/**
 * Resolve the build artifacts root under one repo cache root.
 *
 * @param {string} repoCacheRoot
 * @returns {string}
 */
const resolveBuildsRoot = (repoCacheRoot) => path.join(repoCacheRoot, 'builds');

/**
 * Read one build-state snapshot from a build root directory.
 *
 * @param {string|null} buildRoot
 * @returns {Promise<{state:object,path:string}|null>}
 */
const readBuildState = async (buildRoot) => {
  if (!buildRoot) return null;
  const statePath = path.join(buildRoot, BUILD_STATE_FILE);
  try {
    const raw = await fsPromises.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { state: parsed, path: statePath } : null;
  } catch {
    return null;
  }
};

/**
 * Enumerate build directories that currently expose `build_state.json`.
 *
 * Returned list is sorted newest-first by state file mtime so callers can
 * prefer active/latest builds without scanning timestamps again.
 *
 * @param {string} repoCacheRoot
 * @returns {Promise<Array<{buildRoot:string,statePath:string,mtimeMs:number}>>}
 */
const listBuildStateCandidates = async (repoCacheRoot) => {
  const buildsRoot = resolveBuildsRoot(repoCacheRoot);
  let entries;
  try {
    entries = await fsPromises.readdir(buildsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const buildRoot = path.join(buildsRoot, entry.name);
    const statePath = path.join(buildRoot, BUILD_STATE_FILE);
    try {
      const stat = await fsPromises.stat(statePath);
      candidates.push({ buildRoot, statePath, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

/**
 * Pick the newest viable build-state snapshot for stage progress reporting.
 *
 * @param {string} repoCacheRoot
 * @param {string|null} stage
 * @param {number} sinceMs
 * @returns {Promise<{buildRoot:string,state:object,path:string}|null>}
 */
const pickBuildState = async (repoCacheRoot, stage, sinceMs) => {
  const candidates = await listBuildStateCandidates(repoCacheRoot);
  for (const candidate of candidates) {
    if (Number.isFinite(sinceMs) && candidate.mtimeMs < sinceMs) continue;
    const loaded = await readBuildState(candidate.buildRoot);
    if (!loaded) continue;
    const state = loaded.state;
    if (stage && state?.stage && state.stage !== stage) continue;
    if (stage && state?.phases?.[stage]?.status === 'failed') continue;
    return { buildRoot: candidate.buildRoot, state: loaded.state, path: loaded.path };
  }
  return null;
};

const formatDuration = (ms) => formatDurationMs(ms);

/**
 * Format one progress line from build_state snapshot telemetry.
 *
 * @param {{jobId:string,stage:string|null,state:object}} input
 * @returns {string|null}
 */
const formatProgressLine = ({ jobId, stage, state }) => {
  if (!state) return null;
  const phases = state?.phases || {};
  const phase = stage ? phases?.[stage] : null;
  const phaseOrder = ['discovery', 'preprocessing', stage, 'validation', 'promote'].filter(Boolean);
  const activePhase = phaseOrder.find((name) => phases?.[name]?.status === 'running');
  const startedAtRaw = phase?.startedAt || state?.createdAt || null;
  const startedAt = startedAtRaw ? Date.parse(startedAtRaw) : null;
  const now = Date.now();
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null;
  const progress = state?.progress || {};
  let processedTotal = 0;
  let totalFiles = 0;
  const modeParts = [];
  for (const [mode, data] of Object.entries(progress)) {
    const processed = Number(data?.processedFiles);
    const total = Number(data?.totalFiles);
    if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0) continue;
    processedTotal += processed;
    totalFiles += total;
    modeParts.push(`${mode} ${processed}/${total}`);
  }
  const etaMs = (elapsedMs && processedTotal > 0 && totalFiles > processedTotal)
    ? ((totalFiles - processedTotal) / (processedTotal / (elapsedMs / 1000))) * 1000
    : null;
  const elapsedText = elapsedMs !== null ? formatDuration(elapsedMs) : 'n/a';
  const etaText = Number.isFinite(etaMs) ? formatDuration(etaMs) : 'n/a';
  const status = phase?.status || state?.stage || 'running';
  const progressText = modeParts.length
    ? modeParts.join(' | ')
    : 'progress pending';
  const phaseNote = activePhase && activePhase !== stage ? ` | phase ${activePhase} running` : '';
  return `[indexer] job ${jobId} ${stage || state?.stage || 'stage'} ${status} | ${progressText}${phaseNote} | elapsed ${elapsedText} | eta ${etaText}`;
};

/**
 * Poll build-state artifacts for the active job so long-running work emits
 * periodic progress updates in service worker logs.
 *
 * Returns an async cleanup callback that stops timers and closes tracked
 * lifecycle resources.
 *
 * @param {{job:{id:string},repoPath:string,stage?:string|null}} input
 * @returns {() => Promise<void>}
 */
const startBuildProgressMonitor = ({ job, repoPath, stage }) => {
  if (!job || !repoPath) return async () => {};
  const repoCacheRoot = getRepoCacheRoot(repoPath);
  const startedAt = Date.now();
  let active = null;
  let waitingLogged = false;
  let lastLine = '';
  const lifecycle = createLifecycleRegistry({
    name: `indexer-service-progress:${job.id}`
  });
  const poll = async () => {
    if (!active) {
      active = await pickBuildState(repoCacheRoot, stage, startedAt - BUILD_STATE_LOOKBACK_MS);
    }
    if (!active) {
      if (!waitingLogged) {
        console.error(`[indexer] job ${job.id} ${stage || 'stage'} running; waiting for build state...`);
        waitingLogged = true;
      }
      return;
    }
    const loaded = await readBuildState(active.buildRoot);
    if (loaded?.state) active.state = loaded.state;
    const line = formatProgressLine({ jobId: job.id, stage, state: active.state });
    if (line && line !== lastLine) {
      console.error(line);
      lastLine = line;
    }
  };
  const runPoll = () => {
    if (lifecycle.isClosed()) return;
    lifecycle.registerPromise(poll(), { label: 'indexer-service-progress-poll' });
  };
  const timer = setInterval(() => {
    runPoll();
  }, BUILD_STATE_POLL_MS);
  lifecycle.registerTimer(timer, { label: 'indexer-service-progress-interval' });
  runPoll();
  return async () => {
    await lifecycle.close().catch(() => {});
  };
};

/**
 * Execute a Node subprocess and route output into the shared log helper.
 *
 * @param {string[]} args
 * @param {Record<string, string>} [extraEnv={}]
 * @param {string|null} [logPath=null]
 * @returns {Promise<number>}
 */
const spawnWithLog = async (args, extraEnv = {}, logPath = null) => {
  const result = await runLoggedSubprocess({
    command: process.execPath,
    args,
    env: process.env,
    extraEnv,
    logPath,
    onWriteError: (err) => {
      console.error(`[indexer] failed writing subprocess log (${logPath}): ${err?.message || err}`);
    }
  });
  if (result.errorMessage) {
    const reason = result.timedOut
      ? `timed out after ${result.durationMs ?? 'unknown'}ms`
      : result.errorMessage;
    console.error(`[indexer] subprocess failed: ${reason}`);
  }
  return Number.isFinite(result.exitCode) ? result.exitCode : 1;
};

/**
 * Run `build_index.js` in subprocess mode with either explicit argv passthrough
 * or reconstructed `--repo/--mode/--stage` arguments.
 *
 * @param {string} repoPath
 * @param {string|null} mode
 * @param {string|null} stage
 * @param {string[]|null} [extraArgs]
 * @param {string|null} [logPath]
 * @returns {Promise<number>}
 */
const runBuildIndexSubprocess = (repoPath, mode, stage, extraArgs = null, logPath = null) => {
  const buildPath = path.join(toolRoot, 'build_index.js');
  const args = [buildPath];
  if (Array.isArray(extraArgs) && extraArgs.length) {
    args.push(...extraArgs);
  } else {
    args.push('--repo', repoPath);
    if (mode && mode !== 'both') args.push('--mode', mode);
    if (stage) args.push('--stage', stage);
  }
  const userConfig = loadUserConfig(repoPath);
  const runtimeConfig = getRuntimeConfig(repoPath, userConfig);
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, process.env);
  return spawnWithLog(args, runtimeEnv, logPath);
};

/**
 * Normalize arbitrary values for use inside daemon session key segments.
 *
 * @param {unknown} value
 * @param {string} [fallback='default']
 * @returns {string}
 */
const toSafeSegment = (value, fallback = 'default') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^a-zA-Z0-9._:-]+/g, '_');
};

/**
 * Build a deterministic daemon session key for one repo + queue namespace.
 *
 * Repo path is canonicalized and hashed so keys stay short and safe for
 * logging/metrics tags while remaining stable across runs.
 *
 * @param {{repoPath?:string,queueName?:string,namespace?:string}} [input]
 * @returns {string}
 */
const buildDaemonSessionKey = ({
  repoPath,
  queueName: daemonQueueName = 'index',
  namespace = null
} = {}) => {
  const resolvedRepo = path.resolve(repoPath || process.cwd());
  const canonicalRepo = process.platform === 'win32'
    ? resolvedRepo.toLowerCase()
    : resolvedRepo;
  const digest = crypto.createHash('sha1').update(canonicalRepo).digest('hex').slice(0, 12);
  const queueSegment = toSafeSegment(daemonQueueName, 'index');
  const namespaceSegment = toSafeSegment(namespace || 'service-indexer', 'service-indexer');
  return `${namespaceSegment}:${queueSegment}:${digest}`;
};

/**
 * Append one line to daemon execution logs, creating parent directories lazily.
 *
 * @param {string|null} logPath
 * @param {string} line
 * @returns {Promise<void>}
 */
const appendDaemonLogLine = async (logPath, line) => {
  if (!logPath || !line) return;
  try {
    await fsPromises.mkdir(path.dirname(logPath), { recursive: true });
    await fsPromises.appendFile(logPath, `${line}\n`);
  } catch (err) {
    console.error(`[indexer] failed writing daemon log (${logPath}): ${err?.message || err}`);
  }
};

/**
 * Resolve build-index argv for daemon or subprocess execution.
 *
 * @param {string} repoPath
 * @param {string|null} mode
 * @param {string|null} stage
 * @param {string[]|null} [extraArgs]
 * @returns {string[]}
 */
const resolveBuildIndexArgs = (repoPath, mode, stage, extraArgs = null) => {
  if (Array.isArray(extraArgs) && extraArgs.length) return extraArgs.slice();
  const args = ['--repo', repoPath];
  if (mode && mode !== 'both') args.push('--mode', mode);
  if (stage) args.push('--stage', stage);
  return args;
};

/**
 * Remove CLI parser internals before forwarding args into `buildIndex`.
 *
 * @param {object} argvValue
 * @returns {object}
 */
const sanitizeBuildArgv = (argvValue) => {
  const next = {};
  for (const [key, value] of Object.entries(argvValue || {})) {
    if (key === '_' || key === '$0' || key === 'help' || key === 'h') continue;
    next[key] = value;
  }
  return next;
};

/**
 * Execute build-index request in daemon mode and return normalized result.
 *
 * @param {string} repoPath
 * @param {string|null} mode
 * @param {string|null} stage
 * @param {string[]|null} [extraArgs]
 * @param {string|null} [logPath]
 * @param {object} [daemonOptions]
 * @returns {Promise<{exitCode:number,executionMode:'daemon',daemon:object}>}
 */
const runBuildIndexDaemon = async (
  repoPath,
  mode,
  stage,
  extraArgs = null,
  logPath = null,
  daemonOptions = {}
) => {
  const rawArgs = resolveBuildIndexArgs(repoPath, mode, stage, extraArgs);
  const daemonDeterministic = daemonOptions?.deterministic !== false;
  const daemonHealth = daemonOptions?.health && typeof daemonOptions.health === 'object'
    ? daemonOptions.health
    : null;
  const daemonSessionKey = buildDaemonSessionKey({
    repoPath,
    queueName: daemonOptions?.queueName || 'index',
    namespace: daemonOptions?.sessionNamespace || null
  });
  const startedAt = Date.now();
  await appendDaemonLogLine(
    logPath,
    `[daemon] started ${new Date(startedAt).toISOString()} sessionKey=${daemonSessionKey} args=${JSON.stringify(rawArgs)}`
  );
  try {
    const { argv: parsedArgv } = parseBuildArgs(rawArgs);
    const buildArgv = sanitizeBuildArgv(parsedArgv);
    const resolvedRepo = buildArgv.repo || repoPath;
    await buildIndex(resolvedRepo, {
      ...buildArgv,
      rawArgv: rawArgs,
      daemonEnabled: true,
      daemonDeterministic,
      daemonSessionKey,
      daemonHealth
    });
    const durationMs = Math.max(0, Date.now() - startedAt);
    await appendDaemonLogLine(logPath, `[daemon] completed durationMs=${durationMs}`);
    return {
      exitCode: 0,
      executionMode: 'daemon',
      daemon: {
        sessionKey: daemonSessionKey,
        deterministic: daemonDeterministic,
        durationMs
      }
    };
  } catch (err) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const message = err?.message || String(err);
    await appendDaemonLogLine(logPath, `[daemon] failed durationMs=${durationMs} error=${message}`);
    console.error(`[indexer] daemon build failed: ${message}`);
    return {
      exitCode: 1,
      executionMode: 'daemon',
      daemon: {
        sessionKey: daemonSessionKey,
        deterministic: daemonDeterministic,
        durationMs,
        error: message
      }
    };
  }
};

/**
 * Run embeddings build worker for one repo/build root pair.
 *
 * @param {string} repoPath
 * @param {string|null} mode
 * @param {string} indexRoot
 * @param {Record<string, string>} [extraEnv={}]
 * @param {string|null} [logPath=null]
 * @returns {Promise<number>}
 */
const runBuildEmbeddings = (repoPath, mode, indexRoot, extraEnv = {}, logPath = null) => {
  const buildPath = path.join(toolRoot, 'tools', 'build', 'embeddings.js');
  const args = buildEmbeddingsArgs({ buildPath, repoPath, mode, indexRoot });
  const userConfig = loadUserConfig(repoPath);
  const runtimeConfig = getRuntimeConfig(repoPath, userConfig);
  const envCandidate = { ...process.env, ...extraEnv };
  const runtimeEnv = resolveRuntimeEnv(runtimeConfig, envCandidate);
  return spawnWithLog(args, runtimeEnv, logPath);
};

const handleSync = async () => {
  const targets = argv.repo ? [resolveRepoEntryForArg(argv.repo)].filter(Boolean) : repoEntries;
  if (!targets.length) {
    console.error('No repos configured for sync.');
    process.exit(1);
  }
  const policy = config.sync?.policy || 'pull';
  const results = [];
  for (const entry of targets) {
    const result = await ensureRepo(entry, baseDir, policy);
    results.push({ id: entry.id || entry.path, ...result });
  }
  printPayload({ ok: true, results });
};

const handleEnqueue = async () => {
  const target = resolveRepoEntryForArg(resolveRepoRootArg(argv.repo));
  if (!target) {
    console.error('Repo not found for enqueue.');
    process.exit(1);
  }
  await ensureQueueDir(queueDir);
  const queueConfig = queueName === 'embeddings'
    ? (config.embeddings?.queue || {})
    : (config.queue || {});
  const id = formatJobId();
  const mode = argv.mode || 'both';
  const result = await enqueueJob(queueDir, {
    id,
    createdAt: new Date().toISOString(),
    repo: resolveRepoPath(target, baseDir) || target.path,
    mode,
    reason: argv.reason || null,
    stage: argv.stage || null,
    maxRetries: queueConfig.maxRetries ?? null
  }, queueConfig.maxQueued ?? null, queueName);
  if (!result.ok) {
    console.error(result.message || 'Failed to enqueue job.');
    process.exit(1);
  }
  printPayload({ ok: true, job: result.job });
};

const handleStatus = async () => {
  const summary = await queueSummary(queueDir, resolvedQueueName);
  printPayload({ ok: true, queue: summary, name: resolvedQueueName });
};

const handleSmoke = async () => {
  await ensureQueueDir(queueDir);
  const summary = await queueSummary(queueDir, resolvedQueueName);
  const canonicalCommand = `pairofcleats service indexer work --watch --config \"${configPath}\" --queue ${resolvedQueueName}`;
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

/**
 * Claim and process one queue job, including retries, subprocess execution,
 * heartbeat maintenance, and final completion updates.
 *
 * @param {{processed:number,succeeded:number,failed:number,retried:number}} metrics
 * @returns {Promise<boolean>} true when a job was claimed; false when queue is empty.
 */
const processQueueOnce = async (metrics) => {
  const queueConfig = queueName === 'embeddings'
    ? (config.embeddings?.queue || {})
    : (config.queue || {});
  await requeueStaleJobs(queueDir, resolvedQueueName, {
    maxRetries: Number.isFinite(queueConfig.maxRetries) ? queueConfig.maxRetries : 2
  });
  const job = await claimNextJob(queueDir, resolvedQueueName);
  if (!job) return false;
  metrics.processed += 1;
  const embedWorkerConfig = config.embeddings?.worker || {};
  const memoryMb = Number.isFinite(Number(embedWorkerConfig.maxMemoryMb))
    ? Math.max(128, Math.floor(Number(embedWorkerConfig.maxMemoryMb)))
    : null;
  const extraEnv = memoryMb
    ? { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${memoryMb}`.trim() }
    : {};
  const jobLifecycle = createLifecycleRegistry({
    name: `indexer-service-job:${job.id}`
  });
  const heartbeat = setInterval(() => {
    void touchJobHeartbeat(queueDir, job.id, resolvedQueueName);
  }, 30000);
  jobLifecycle.registerTimer(heartbeat, { label: 'indexer-service-job-heartbeat' });
  const logPath = job.logPath || path.join(queueDir, 'logs', `${job.id}.log`);
  const stopProgress = queueName === 'index'
    ? startBuildProgressMonitor({ job, repoPath: job.repo, stage: job.stage })
    : (async () => {});
  jobLifecycle.registerCleanup(() => stopProgress(), { label: 'indexer-service-progress-stop' });
  let runResult = {
    exitCode: 1,
    executionMode: 'subprocess',
    daemon: null
  };
  try {
    if (queueName === 'embeddings') {
      const normalized = normalizeEmbeddingJob(job);
      if (job.repoRoot && job.repo && path.resolve(job.repoRoot) !== path.resolve(job.repo)) {
        console.error(`[indexer] embedding job ${job.id} repoRoot mismatch (repo=${job.repo}, repoRoot=${job.repoRoot}); using repoRoot.`);
      }
      if (!normalized.buildRoot) {
        await completeJob(
          queueDir,
          job.id,
          'failed',
          {
            exitCode: 1,
            error: 'missing buildRoot for embedding job',
            executionMode: 'subprocess'
          },
          resolvedQueueName
        );
        return true;
      }
      if (!fs.existsSync(normalized.buildRoot)) {
        await completeJob(
          queueDir,
          job.id,
          'failed',
          {
            exitCode: 1,
            error: `embedding buildRoot missing: ${normalized.buildRoot}`,
            executionMode: 'subprocess'
          },
          resolvedQueueName
        );
        return true;
      }
      if (normalized.formatVersion && normalized.formatVersion < 2) {
        console.error(`[indexer] embedding job ${job.id} uses legacy payload; upgrading for processing.`);
      }
      if (normalized.indexDir) {
        const rel = path.relative(normalized.buildRoot, normalized.indexDir);
        if (!rel || rel.startsWith('..') || isAbsolutePathNative(rel)) {
          console.error(`[indexer] embedding job ${job.id} indexDir not under buildRoot; continuing with buildRoot only.`);
        }
      }
      const exitCode = await jobLifecycle.registerPromise(
        runBuildEmbeddings(
          normalized.repoRoot || job.repo,
          job.mode,
          normalized.buildRoot,
          extraEnv,
          logPath
        ),
        { label: 'indexer-service-run-embeddings' }
      );
      runResult = {
        exitCode,
        executionMode: 'subprocess',
        daemon: null
      };
    } else {
      if (serviceExecutionMode === 'daemon') {
        const daemonWorkerConfig = config.worker?.daemon && typeof config.worker.daemon === 'object'
          ? config.worker.daemon
          : {};
        runResult = await jobLifecycle.registerPromise(
          runBuildIndexDaemon(
            job.repo,
            job.mode,
            job.stage,
            job.args,
            logPath,
            {
              queueName: resolvedQueueName,
              deterministic: daemonWorkerConfig.deterministic !== false,
              sessionNamespace: daemonWorkerConfig.sessionNamespace || null,
              health: daemonWorkerConfig.health || null
            }
          ),
          { label: 'indexer-service-run-index-daemon' }
        );
      } else {
        const exitCode = await jobLifecycle.registerPromise(
          runBuildIndexSubprocess(job.repo, job.mode, job.stage, job.args, logPath),
          { label: 'indexer-service-run-index-subprocess' }
        );
        runResult = {
          exitCode,
          executionMode: 'subprocess',
          daemon: null
        };
      }
    }
  } finally {
    await jobLifecycle.close().catch(() => {});
  }
  const exitCode = Number.isFinite(runResult?.exitCode) ? runResult.exitCode : 1;
  const executionMode = runResult?.executionMode === 'daemon' ? 'daemon' : 'subprocess';
  const daemonResult = runResult?.daemon && typeof runResult.daemon === 'object'
    ? runResult.daemon
    : null;
  const status = exitCode === 0 ? 'done' : 'failed';
  const attempts = Number.isFinite(job.attempts) ? job.attempts : 0;
  const maxRetries = Number.isFinite(job.maxRetries)
    ? job.maxRetries
    : (Number.isFinite(queueConfig.maxRetries) ? queueConfig.maxRetries : 0);
  if (status === 'failed' && maxRetries > attempts) {
    const nextAttempts = attempts + 1;
    metrics.retried += 1;
    await completeJob(
      queueDir,
      job.id,
      'queued',
      {
        exitCode,
        retry: true,
        attempts: nextAttempts,
        error: `exit ${exitCode}`,
        executionMode,
        daemon: daemonResult
      },
      resolvedQueueName
    );
    return true;
  }
  if (status === 'done') {
    metrics.succeeded += 1;
  } else {
    metrics.failed += 1;
  }
  await completeJob(
    queueDir,
    job.id,
    status,
    {
      exitCode,
      error: `exit ${exitCode}`,
      executionMode,
      daemon: daemonResult
    },
    resolvedQueueName
  );
  return true;
};

/**
 * Drain queue jobs with bounded concurrency and optional watch-loop polling.
 *
 * @returns {Promise<void>}
 */
const handleWork = async () => {
  await ensureQueueDir(queueDir);
  const workerConfig = queueName === 'embeddings'
    ? (config.embeddings?.worker || {})
    : (config.worker || {});
  const requestedConcurrency = Number.isFinite(Number(argv.concurrency))
    ? Math.max(1, Number(argv.concurrency))
    : (workerConfig.concurrency || 1);
  const concurrency = serviceExecutionMode === 'daemon' && queueName === 'index'
    ? 1
    : requestedConcurrency;
  if (concurrency !== requestedConcurrency) {
    console.error(`[indexer] daemon execution enforces concurrency=1 (requested=${requestedConcurrency}).`);
  }
  const intervalMs = Number.isFinite(Number(argv.interval))
    ? Math.max(100, Number(argv.interval))
    : (config.sync?.intervalMs || 5000);
  const runBatch = async () => {
    const metrics = { processed: 0, succeeded: 0, failed: 0, retried: 0 };
    const workers = Array.from({ length: concurrency }, async () => {
      let worked = true;
      while (worked) {
        worked = await processQueueOnce(metrics);
      }
    });
    await Promise.all(workers);
    if (metrics.processed) {
      printPayload({
        ok: true,
        queue: resolvedQueueName,
        metrics,
        at: new Date().toISOString()
      });
    }
  };
  await runBatch();
  if (argv.watch) {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      await runBatch();
    }
  }
};

const handleServe = async () => {
  const apiPath = path.join(toolRoot, 'tools', 'api', 'server.js');
  const repoArg = resolveRepoRootArg(argv.repo);
  logThreadpoolInfo(repoArg, 'indexer');
  const userConfig = loadUserConfig(repoArg);
  const runtimeConfig = getRuntimeConfig(repoArg, userConfig);
  const env = resolveRuntimeEnv(runtimeConfig, process.env);
  const result = await spawnSubprocess(process.execPath, [apiPath, '--repo', repoArg], {
    stdio: 'inherit',
    env,
    rejectOnNonZeroExit: false
  });
  process.exit(result.exitCode ?? 0);
};

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
  console.error('Usage: indexer-service <sync|enqueue|work|status|smoke|serve> [--queue index|embeddings] [--stage stage1|stage2|stage3|stage4]');
  process.exit(1);
}
