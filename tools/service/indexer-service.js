#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { resolveRepoRootArg, getCacheRoot, getRepoCacheRoot, getRuntimeConfig, loadUserConfig, resolveRuntimeEnv, resolveToolRoot } from '../shared/dict-utils.js';
import { getServiceConfigPath, loadServiceConfig, resolveRepoRegistry } from './config.js';
import { ensureQueueDir, enqueueJob, claimNextJob, completeJob, queueSummary, resolveQueueName, requeueStaleJobs, touchJobHeartbeat } from './queue.js';
import { ensureRepo, resolveRepoEntry, resolveRepoPath } from './repos.js';
import { buildEmbeddingsArgs, normalizeEmbeddingJob } from './indexer-service-helpers.js';

const argv = createCli({
  scriptName: 'indexer-service',
  options: {
    config: { type: 'string' },
    repo: { type: 'string' },
    mode: { type: 'string', default: 'all' },
    reason: { type: 'string' },
    stage: { type: 'string' },
    command: { type: 'string' },
    watch: { type: 'boolean', default: false },
    interval: { type: 'number' },
    concurrency: { type: 'number' },
    queue: { type: 'string', default: 'index' }
  }
}).parse();

const command = argv.command || String(argv._[0] || '');
const configPath = getServiceConfigPath(argv.config || null);
const config = loadServiceConfig(configPath);
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

const resolveRepoEntryForArg = (repoArg) => resolveRepoEntry(repoArg, repoEntries, baseDir);

const formatJobId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const toolRoot = resolveToolRoot();


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

const resolveBuildsRoot = (repoCacheRoot) => path.join(repoCacheRoot, 'builds');

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

const formatDuration = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

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

const startBuildProgressMonitor = ({ job, repoPath, stage }) => {
  if (!job || !repoPath) return () => {};
  const repoCacheRoot = getRepoCacheRoot(repoPath);
  const startedAt = Date.now();
  let active = null;
  let waitingLogged = false;
  let lastLine = '';
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
  const timer = setInterval(() => {
    void poll();
  }, BUILD_STATE_POLL_MS);
  void poll();
  return () => clearInterval(timer);
};

const spawnWithLog = async (args, extraEnv = {}, logPath = null) => {
  const useLog = typeof logPath === 'string' && logPath.trim();
  const stdio = useLog ? ['ignore', 'pipe', 'pipe'] : 'inherit';
  try {
    const result = await spawnSubprocess(process.execPath, args, {
      stdio,
      env: { ...process.env, ...extraEnv },
      rejectOnNonZeroExit: false,
      captureStdout: useLog,
      captureStderr: useLog,
      outputMode: 'string'
    });
    if (useLog) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const parts = [];
      parts.push(`[${new Date().toISOString()}] job start`);
      const stdoutText = typeof result.stdout === 'string' ? result.stdout : '';
      const stderrText = typeof result.stderr === 'string' ? result.stderr : '';
      if (stdoutText) parts.push(stdoutText.trimEnd());
      if (stderrText) parts.push(stderrText.trimEnd());
      parts.push(`[${new Date().toISOString()}] job exit ${result.exitCode ?? 1}`);
      fs.appendFileSync(logPath, `${parts.join('\n')}\n`);
    }
    return result.exitCode ?? 1;
  } catch (err) {
    if (useLog) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const message = err?.message || String(err);
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] job error ${message}\n`);
    }
    return 1;
  }
};

const runBuildIndex = (repoPath, mode, stage, extraArgs = null, logPath = null) => {
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
  console.log(JSON.stringify({ ok: true, results }, null, 2));
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
  console.log(JSON.stringify({ ok: true, job: result.job }, null, 2));
};

const handleStatus = async () => {
  const summary = await queueSummary(queueDir, resolvedQueueName);
  console.log(JSON.stringify({ ok: true, queue: summary, name: resolvedQueueName }, null, 2));
};

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
  const heartbeat = setInterval(() => {
    void touchJobHeartbeat(queueDir, job.id, resolvedQueueName);
  }, 30000);
  const logPath = job.logPath || path.join(queueDir, 'logs', `${job.id}.log`);
  const stopProgress = queueName === 'index'
    ? startBuildProgressMonitor({ job, repoPath: job.repo, stage: job.stage })
    : () => {};
  let exitCode;
  try {
    if (queueName === 'embeddings') {
      const normalized = normalizeEmbeddingJob(job);
      if (job.repoRoot && job.repo && path.resolve(job.repoRoot) !== path.resolve(job.repo)) {
        console.error(`[indexer] embedding job ${job.id} repoRoot mismatch (repo=${job.repo}, repoRoot=${job.repoRoot}); using repoRoot.`);
      }
      if (!normalized.buildRoot) {
        await completeJob(queueDir, job.id, 'failed', { exitCode: 1, error: 'missing buildRoot for embedding job' }, resolvedQueueName);
        return true;
      }
      if (!fs.existsSync(normalized.buildRoot)) {
        await completeJob(
          queueDir,
          job.id,
          'failed',
          { exitCode: 1, error: `embedding buildRoot missing: ${normalized.buildRoot}` },
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
      exitCode = await runBuildEmbeddings(
        normalized.repoRoot || job.repo,
        job.mode,
        normalized.buildRoot,
        extraEnv,
        logPath
      );
    } else {
      exitCode = await runBuildIndex(job.repo, job.mode, job.stage, job.args, logPath);
    }
  } finally {
    stopProgress();
    clearInterval(heartbeat);
  }
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
      { exitCode, retry: true, attempts: nextAttempts, error: `exit ${exitCode}` },
      resolvedQueueName
    );
    return true;
  }
  if (status === 'done') {
    metrics.succeeded += 1;
  } else {
    metrics.failed += 1;
  }
  await completeJob(queueDir, job.id, status, { exitCode, error: `exit ${exitCode}` }, resolvedQueueName);
  return true;
};

const handleWork = async () => {
  await ensureQueueDir(queueDir);
  const workerConfig = queueName === 'embeddings'
    ? (config.embeddings?.worker || {})
    : (config.worker || {});
  const concurrency = Number.isFinite(Number(argv.concurrency))
    ? Math.max(1, Number(argv.concurrency))
    : (workerConfig.concurrency || 1);
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
      console.log(JSON.stringify({
        ok: true,
        queue: resolvedQueueName,
        metrics,
        at: new Date().toISOString()
      }, null, 2));
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
} else if (command === 'serve') {
  await handleServe();
} else {
  console.error('Usage: indexer-service <sync|enqueue|work|status|serve> [--queue index|embeddings] [--stage stage1|stage2|stage3|stage4]');
  process.exit(1);
}
