#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCli } from '../src/shared/cli.js';
import { resolveRepoRoot, getCacheRoot } from './dict-utils.js';
import { getServiceConfigPath, loadServiceConfig, resolveRepoRegistry } from './service/config.js';
import { ensureQueueDir, enqueueJob, claimNextJob, completeJob, queueSummary } from './service/queue.js';
import { ensureRepo, resolveRepoPath } from './service/repos.js';

const argv = createCli({
  scriptName: 'indexer-service',
  options: {
    config: { type: 'string' },
    repo: { type: 'string' },
    mode: { type: 'string', default: 'both' },
    reason: { type: 'string' },
    command: { type: 'string' },
    watch: { type: 'boolean', default: false },
    interval: { type: 'number' },
    concurrency: { type: 'number' }
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

const resolveRepoEntry = (repoArg) => {
  if (!repoArg) return null;
  const resolved = path.resolve(repoArg);
  return repoEntries.find((entry) => resolveRepoPath(entry, baseDir) === resolved)
    || repoEntries.find((entry) => entry.id === repoArg)
    || { id: repoArg, path: resolved, syncPolicy: 'none' };
};

const formatJobId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runBuildIndex = (repoPath, mode) => new Promise((resolve) => {
  const buildPath = path.join(path.resolve(__dirname, '..'), 'build_index.js');
  const args = [buildPath, '--repo', repoPath];
  if (mode && mode !== 'both') args.push('--mode', mode);
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
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
  const id = formatJobId();
  const mode = argv.mode || 'both';
  const result = await enqueueJob(queueDir, {
    id,
    createdAt: new Date().toISOString(),
    repo: resolveRepoPath(target, baseDir) || target.path,
    mode,
    reason: argv.reason || null
  }, config.queue?.maxQueued ?? null);
  if (!result.ok) {
    console.error(result.message || 'Failed to enqueue job.');
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, job: result.job }, null, 2));
};

const handleStatus = async () => {
  const summary = await queueSummary(queueDir);
  console.log(JSON.stringify({ ok: true, queue: summary }, null, 2));
};

const processQueueOnce = async () => {
  const job = await claimNextJob(queueDir);
  if (!job) return false;
  const exitCode = await runBuildIndex(job.repo, job.mode);
  const status = exitCode === 0 ? 'done' : 'failed';
  await completeJob(queueDir, job.id, status, { exitCode });
  return true;
};

const handleWork = async () => {
  await ensureQueueDir(queueDir);
  const concurrency = Number.isFinite(Number(argv.concurrency))
    ? Math.max(1, Number(argv.concurrency))
    : (config.worker?.concurrency || 1);
  const intervalMs = Number.isFinite(Number(argv.interval))
    ? Math.max(100, Number(argv.interval))
    : (config.sync?.intervalMs || 5000);
  const runBatch = async () => {
    const workers = Array.from({ length: concurrency }, async () => {
      let worked = true;
      while (worked) {
        worked = await processQueueOnce();
      }
    });
    await Promise.all(workers);
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
  const apiPath = path.join(path.resolve(__dirname, '..'), 'tools', 'api-server.js');
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
  console.error('Usage: indexer-service <sync|enqueue|work|status|serve>');
  process.exit(1);
}
