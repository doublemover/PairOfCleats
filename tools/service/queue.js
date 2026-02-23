import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { acquireFileLock } from '../../src/shared/locks/file-lock.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';

const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;

const readJson = async (filePath, fallback) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const withLock = async (lockPath, worker) => {
  const lock = await acquireFileLock({
    lockPath,
    waitMs: 5000,
    pollMs: 100,
    staleMs: DEFAULT_LOCK_STALE_MS,
    metadata: { scope: 'service-queue' },
    timeoutBehavior: 'throw',
    timeoutMessage: 'Queue lock timeout.'
  });
  if (!lock) throw new Error('Queue lock timeout.');
  try {
    return await worker();
  } finally {
    await lock.release();
  }
};

export async function ensureQueueDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

const ensureJobDirs = async (dirPath) => {
  const logsDir = path.join(dirPath, 'logs');
  const reportsDir = path.join(dirPath, 'reports');
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });
  return { logsDir, reportsDir };
};

const normalizeQueueName = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw || raw === 'index') return null;
  return raw.replace(/[^a-z0-9_-]+/g, '-');
};

export function resolveQueueName(queueName, job = null) {
  const normalized = normalizeQueueName(queueName);
  if (normalized && normalized !== 'auto') return normalized;
  if (normalized === 'auto') {
    const base = job?.reason === 'embeddings' ? 'embeddings' : 'index';
    const parts = [];
    if (job?.stage) parts.push(String(job.stage).toLowerCase());
    if (job?.mode && job.mode !== 'both') parts.push(String(job.mode).toLowerCase());
    return parts.length ? `${base}-${parts.join('-')}` : base;
  }
  return normalized;
}

export function getQueuePaths(dirPath, queueName = null) {
  const normalized = normalizeQueueName(queueName);
  const suffix = normalized ? `-${normalized}` : '';
  return {
    queuePath: path.join(dirPath, `queue${suffix}.json`),
    lockPath: path.join(dirPath, `queue${suffix}.lock`)
  };
}

export async function loadQueue(dirPath, queueName = null) {
  const { queuePath } = getQueuePaths(dirPath, queueName);
  const payload = await readJson(queuePath, { jobs: [] });
  return {
    jobs: Array.isArray(payload.jobs) ? payload.jobs : []
  };
}

export async function saveQueue(dirPath, queue, queueName = null) {
  const { queuePath } = getQueuePaths(dirPath, queueName);
  await atomicWriteJson(queuePath, queue, { spaces: 2 });
}

/**
 * Enqueue one job payload after queue-capacity checks and path normalization.
 *
 * The returned job includes resolved log/report file paths and normalized retry
 * policy fields that downstream workers rely on.
 *
 * @param {string} dirPath
 * @param {object} job
 * @param {number|null} [maxQueued=null]
 * @param {string|null} [queueName=null]
 * @returns {Promise<{ok:boolean,job?:object,message?:string}>}
 */
export async function enqueueJob(dirPath, job, maxQueued = null, queueName = null) {
  await ensureQueueDir(dirPath);
  const { logsDir, reportsDir } = await ensureJobDirs(dirPath);
  const resolvedQueueName = resolveQueueName(queueName, job);
  const { lockPath } = getQueuePaths(dirPath, resolvedQueueName);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath, resolvedQueueName);
    const queued = queue.jobs.filter((entry) => entry.status === 'queued');
    if (Number.isFinite(maxQueued) && queued.length >= maxQueued) {
      return { ok: false, message: 'Queue is full.' };
    }
    const maxRetries = Number.isFinite(Number(job.maxRetries)) && Number(job.maxRetries) >= 0
      ? Math.floor(Number(job.maxRetries))
      : null;
    const next = {
      id: job.id,
      createdAt: job.createdAt,
      status: 'queued',
      repo: job.repo,
      repoRoot: job.repoRoot || job.repo || null,
      mode: job.mode,
      reason: job.reason || null,
      stage: job.stage || null,
      buildId: job.buildId || null,
      buildRoot: job.buildRoot || null,
      indexDir: job.indexDir || null,
      indexRoot: job.indexRoot || null,
      configHash: job.configHash || null,
      repoProvenance: job.repoProvenance || null,
      embeddingIdentity: job.embeddingIdentity || null,
      embeddingIdentityKey: job.embeddingIdentityKey || null,
      embeddingPayloadFormatVersion: Number.isFinite(Number(job.embeddingPayloadFormatVersion))
        ? Math.max(1, Math.floor(Number(job.embeddingPayloadFormatVersion)))
        : null,
      args: Array.isArray(job.args) && job.args.length ? job.args : null,
      attempts: 0,
      maxRetries,
      nextEligibleAt: null,
      lastHeartbeatAt: null,
      logPath: path.join(logsDir, `${job.id}.log`),
      reportPath: path.join(reportsDir, `${job.id}.json`)
    };
    queue.jobs.push(next);
    await saveQueue(dirPath, queue, resolvedQueueName);
    return { ok: true, job: next };
  });
}

export async function claimNextJob(dirPath, queueName = null) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const { logsDir, reportsDir } = await ensureJobDirs(dirPath);
    const queue = await loadQueue(dirPath, queueName);
    const now = Date.now();
    const job = queue.jobs.find((entry) => {
      if (entry.status !== 'queued') return false;
      if (!entry.nextEligibleAt) return true;
      const eligibleAt = Date.parse(entry.nextEligibleAt);
      return Number.isNaN(eligibleAt) || eligibleAt <= now;
    });
    if (!job) return null;
    if (!job.logPath) job.logPath = path.join(logsDir, `${job.id}.log`);
    if (!job.reportPath) job.reportPath = path.join(reportsDir, `${job.id}.json`);
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.lastHeartbeatAt = job.startedAt;
    await saveQueue(dirPath, queue, queueName);
    return job;
  });
}

export async function completeJob(dirPath, jobId, status, result, queueName = null) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const { reportsDir } = await ensureJobDirs(dirPath);
    const queue = await loadQueue(dirPath, queueName);
    const job = queue.jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    job.status = status;
    job.finishedAt = new Date().toISOString();
    job.result = result || null;
    if (Number.isFinite(result?.attempts)) {
      job.attempts = Math.max(0, Math.floor(result.attempts));
    }
    if (result?.error) {
      job.lastError = result.error;
    }
    job.lastHeartbeatAt = null;
    await saveQueue(dirPath, queue, queueName);
    const reportPath = job.reportPath || path.join(reportsDir, `${job.id}.json`);
    try {
      await atomicWriteJson(reportPath, {
        updatedAt: new Date().toISOString(),
        status: job.status,
        job
      }, { spaces: 2 });
    } catch {}
    return job;
  });
}

export async function touchJobHeartbeat(dirPath, jobId, queueName = null) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath, queueName);
    const job = queue.jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    if (job.status !== 'running') return job;
    job.lastHeartbeatAt = new Date().toISOString();
    await saveQueue(dirPath, queue, queueName);
    return job;
  });
}

const resolveStaleThresholdMs = (job, queueName) => {
  const stage = typeof job?.stage === 'string' ? job.stage.toLowerCase() : '';
  if (queueName === 'embeddings' || job?.reason === 'embeddings' || stage === 'stage3') {
    return 15 * 60 * 1000;
  }
  if (stage === 'stage2') return 10 * 60 * 1000;
  return null;
};

const resolveRetryDelayMs = (attempts) => {
  if (attempts <= 0) return 0;
  if (attempts === 1) return 2 * 60 * 1000;
  return 10 * 60 * 1000;
};

/**
 * Requeue or fail stale running jobs whose heartbeat exceeded stage thresholds.
 *
 * Retry behavior is deterministic: attempts are incremented once per stale
 * detection, delayed by `resolveRetryDelayMs`, and failed when max retries are
 * exhausted.
 *
 * @param {string} dirPath
 * @param {string|null} [queueName=null]
 * @param {{maxRetries?:number}} [options={}]
 * @returns {Promise<{stale:number,retried:number,failed:number}>}
 */
export async function requeueStaleJobs(dirPath, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath, queueName);
    const now = Date.now();
    const stale = [];
    for (const job of queue.jobs) {
      if (job.status !== 'running') continue;
      const threshold = resolveStaleThresholdMs(job, queueName);
      if (!threshold) continue;
      const heartbeatAt = Date.parse(job.lastHeartbeatAt || job.startedAt || '');
      if (Number.isNaN(heartbeatAt)) continue;
      if (now - heartbeatAt <= threshold) continue;
      stale.push(job);
    }
    if (!stale.length) return { stale: 0, retried: 0, failed: 0 };
    let retried = 0;
    let failed = 0;
    for (const job of stale) {
      const attempts = Number.isFinite(job.attempts) ? job.attempts : 0;
      const maxRetries = Number.isFinite(job.maxRetries)
        ? job.maxRetries
        : (Number.isFinite(options.maxRetries) ? options.maxRetries : 2);
      const nextAttempts = attempts + 1;
      if (nextAttempts <= maxRetries) {
        retried += 1;
        job.status = 'queued';
        job.attempts = nextAttempts;
        job.lastError = 'stale job heartbeat';
        const delayMs = resolveRetryDelayMs(nextAttempts);
        job.nextEligibleAt = new Date(now + delayMs).toISOString();
      } else {
        failed += 1;
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.result = { error: 'stale job heartbeat', attempts: nextAttempts };
      }
      job.lastHeartbeatAt = null;
    }
    await saveQueue(dirPath, queue, queueName);
    return { stale: stale.length, retried, failed };
  });
}

export async function queueSummary(dirPath, queueName = null) {
  const { queuePath } = getQueuePaths(dirPath, queueName);
  if (!fsSync.existsSync(queuePath)) {
    return { total: 0, queued: 0, running: 0, done: 0, failed: 0, retries: 0 };
  }
  const queue = await loadQueue(dirPath, queueName);
  const summary = { total: queue.jobs.length, queued: 0, running: 0, done: 0, failed: 0, retries: 0 };
  for (const job of queue.jobs) {
    if (job.status === 'queued') summary.queued += 1;
    else if (job.status === 'running') summary.running += 1;
    else if (job.status === 'done') summary.done += 1;
    else if (job.status === 'failed') summary.failed += 1;
    if (Number.isFinite(job.attempts) && job.attempts > 0) summary.retries += 1;
  }
  return summary;
}
