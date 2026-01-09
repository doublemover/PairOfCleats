#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createCli } from '../src/shared/cli.js';
import { resolveRepoRoot, getCacheRoot, resolveToolRoot } from './dict-utils.js';
import { getServiceConfigPath, loadServiceConfig, resolveRepoRegistry } from './service/config.js';
import { ensureQueueDir, enqueueJob, claimNextJob, completeJob, queueSummary, resolveQueueName, requeueStaleJobs, touchJobHeartbeat } from './service/queue.js';
import { ensureRepo, resolveRepoPath } from './service/repos.js';

const argv = createCli({
  scriptName: 'indexer-service',
  options: {
    config: { type: 'string' },
    repo: { type: 'string' },
    mode: { type: 'string', default: 'both' },
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

const resolveRepoEntry = (repoArg) => {
  if (!repoArg) return null;
  const resolved = path.resolve(repoArg);
  return repoEntries.find((entry) => resolveRepoPath(entry, baseDir) === resolved)
    || repoEntries.find((entry) => entry.id === repoArg)
    || { id: repoArg, path: resolved, syncPolicy: 'none' };
};

const formatJobId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const toolRoot = resolveToolRoot();

const runBuildIndex = (repoPath, mode, stage, extraArgs = null) => new Promise((resolve) => {
  const buildPath = path.join(toolRoot, 'build_index.js');
  const args = [buildPath];
  if (Array.isArray(extraArgs) && extraArgs.length) {
    args.push(...extraArgs);
  } else {
    args.push('--repo', repoPath);
    if (mode && mode !== 'both') args.push('--mode', mode);
    if (stage) args.push('--stage', stage);
  }
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  child.on('close', (code) => resolve(code ?? 1));
});

const runBuildEmbeddings = (repoPath, mode, extraEnv = {}) => new Promise((resolve) => {
  const buildPath = path.join(toolRoot, 'tools', 'build-embeddings.js');
  const args = [buildPath, '--repo', repoPath];
  if (mode && mode !== 'both') args.push('--mode', mode);
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  child.on('close', (code) => resolve(code ?? 1));
});

const handleSync = async () => {
  const targets = argv.repo ? [resolveRepoEntry(argv.repo)].filter(Boolean) : repoEntries;
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
  const target = resolveRepoEntry(argv.repo || resolveRepoRoot(process.cwd()));
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
  const exitCode = queueName === 'embeddings'
    ? await runBuildEmbeddings(job.repo, job.mode, extraEnv)
    : await runBuildIndex(job.repo, job.mode, job.stage, job.args);
  clearInterval(heartbeat);
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
  const apiPath = path.join(toolRoot, 'tools', 'api-server.js');
  const repoArg = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
  const child = spawn(process.execPath, [apiPath, '--repo', repoArg], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
};

if (command === 'sync') {
  await handleSync();
} else if (command === 'enqueue') {
  await handleEnqueue();
} else if (command === 'work') {
  await handleWork();
} else if (command === 'status') {
  await handleStatus();
} else if (command === 'serve') {
  await handleServe();
} else {
  console.error('Usage: indexer-service <sync|enqueue|work|status|serve> [--queue index|embeddings] [--stage stage1|stage2|stage3|stage4]');
  process.exit(1);
}
