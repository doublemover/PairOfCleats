import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { acquireFileLock } from '../../src/shared/locks/file-lock.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';

const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const VALID_JOB_STATUSES = new Set(['queued', 'running', 'done', 'failed']);
const ALLOWED_TRANSITIONS = Object.freeze({
  queued: new Set(['running']),
  running: new Set(['queued', 'done', 'failed']),
  done: new Set(),
  failed: new Set()
});

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

const createQueueError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeIsoTimestamp = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

const normalizeLeaseOwner = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || `pid:${process.pid}`;
};

const normalizeLease = (job = {}) => {
  const legacyVersion = Number(job?.leaseVersion);
  const nestedVersion = Number(job?.lease?.version);
  const version = Number.isFinite(nestedVersion)
    ? Math.max(0, Math.trunc(nestedVersion))
    : (Number.isFinite(legacyVersion) ? Math.max(0, Math.trunc(legacyVersion)) : 0);
  const nestedOwner = typeof job?.lease?.owner === 'string' ? job.lease.owner : null;
  const legacyOwner = typeof job?.leaseOwner === 'string' ? job.leaseOwner : null;
  return {
    owner: (nestedOwner || legacyOwner || '').trim() || null,
    version,
    expiresAt: normalizeIsoTimestamp(job?.lease?.expiresAt || job?.leaseExpiresAt || null),
    acquiredAt: normalizeIsoTimestamp(job?.lease?.acquiredAt || null),
    renewedAt: normalizeIsoTimestamp(job?.lease?.renewedAt || null),
    releasedAt: normalizeIsoTimestamp(job?.lease?.releasedAt || null),
    releasedReason: typeof job?.lease?.releasedReason === 'string' && job.lease.releasedReason.trim()
      ? job.lease.releasedReason.trim()
      : null,
    lastOwner: typeof job?.lease?.lastOwner === 'string' && job.lease.lastOwner.trim()
      ? job.lease.lastOwner.trim()
      : null
  };
};

const normalizeTransition = (job = {}, status = 'queued') => {
  const transition = job?.transition && typeof job.transition === 'object'
    ? job.transition
    : {};
  const sequence = Number.isFinite(Number(transition.sequence))
    ? Math.max(0, Math.trunc(Number(transition.sequence)))
    : 0;
  return {
    sequence,
    from: typeof transition.from === 'string' && transition.from.trim() ? transition.from : null,
    to: status,
    at: normalizeIsoTimestamp(transition.at || job.finishedAt || job.startedAt || job.createdAt || null),
    reason: typeof transition.reason === 'string' && transition.reason.trim() ? transition.reason.trim() : null
  };
};

const normalizeJobRecord = (job = {}) => {
  const status = VALID_JOB_STATUSES.has(job?.status) ? job.status : 'queued';
  const attempts = Number.isFinite(Number(job?.attempts))
    ? Math.max(0, Math.trunc(Number(job.attempts)))
    : 0;
  const maxRetries = Number.isFinite(Number(job?.maxRetries))
    ? Math.max(0, Math.trunc(Number(job.maxRetries)))
    : null;
  return {
    ...job,
    status,
    attempts,
    maxRetries,
    nextEligibleAt: normalizeIsoTimestamp(job?.nextEligibleAt || null),
    createdAt: normalizeIsoTimestamp(job?.createdAt || null) || new Date().toISOString(),
    startedAt: normalizeIsoTimestamp(job?.startedAt || null),
    finishedAt: normalizeIsoTimestamp(job?.finishedAt || null),
    lastHeartbeatAt: normalizeIsoTimestamp(job?.lastHeartbeatAt || null),
    lease: normalizeLease(job),
    transition: normalizeTransition(job, status)
  };
};

const assertAllowedTransition = (job, nextStatus) => {
  const currentStatus = VALID_JOB_STATUSES.has(job?.status) ? job.status : 'queued';
  if (!VALID_JOB_STATUSES.has(nextStatus)) {
    throw createQueueError('QUEUE_INVALID_STATUS', `Unsupported queue status "${nextStatus}".`);
  }
  if (currentStatus === nextStatus) return currentStatus;
  if (!ALLOWED_TRANSITIONS[currentStatus]?.has(nextStatus)) {
    throw createQueueError(
      'QUEUE_INVALID_TRANSITION',
      `Invalid queue transition ${currentStatus} -> ${nextStatus}.`
    );
  }
  return currentStatus;
};

const recordTransition = (job, from, to, reason, at) => {
  const current = normalizeTransition(job, to);
  job.transition = {
    sequence: current.sequence + 1,
    from,
    to,
    at,
    reason
  };
};

const resolveLeaseDurationMs = (job, queueName = null, overrideMs = null) => {
  const parsedOverride = Number(overrideMs);
  if (Number.isFinite(parsedOverride) && parsedOverride > 0) {
    return Math.max(1000, Math.trunc(parsedOverride));
  }
  const stage = typeof job?.stage === 'string' ? job.stage.toLowerCase() : '';
  if (queueName === 'embeddings' || job?.reason === 'embeddings' || stage === 'stage3') {
    return 15 * 60 * 1000;
  }
  if (stage === 'stage2') return 10 * 60 * 1000;
  return DEFAULT_LEASE_MS;
};

const setLease = (job, {
  ownerId,
  leaseMs,
  at,
  queueName,
  incrementVersion = false
}) => {
  const lease = normalizeLease(job);
  const owner = normalizeLeaseOwner(ownerId);
  lease.owner = owner;
  lease.version = incrementVersion ? lease.version + 1 : Math.max(1, lease.version);
  lease.acquiredAt = incrementVersion ? at : (lease.acquiredAt || at);
  lease.renewedAt = at;
  lease.expiresAt = new Date(Date.parse(at) + resolveLeaseDurationMs(job, queueName, leaseMs)).toISOString();
  lease.releasedAt = null;
  lease.releasedReason = null;
  job.lease = lease;
  return lease;
};

const clearLease = (job, at, reason) => {
  const lease = normalizeLease(job);
  lease.lastOwner = lease.owner || lease.lastOwner || null;
  lease.owner = null;
  lease.expiresAt = null;
  lease.renewedAt = null;
  lease.releasedAt = at;
  lease.releasedReason = reason;
  job.lease = lease;
};

const assertLeaseOwnership = (job, { ownerId = null, expectedLeaseVersion = null } = {}) => {
  const lease = normalizeLease(job);
  if (job.status !== 'running') {
    throw createQueueError('QUEUE_INVALID_TRANSITION', `Job ${job.id} is not running.`);
  }
  if (!lease.owner) {
    throw createQueueError('QUEUE_LEASE_MISMATCH', `Job ${job.id} has no active lease owner.`);
  }
  const normalizedOwner = ownerId ? normalizeLeaseOwner(ownerId) : null;
  if (normalizedOwner && lease.owner !== normalizedOwner) {
    throw createQueueError(
      'QUEUE_LEASE_MISMATCH',
      `Job ${job.id} lease owned by ${lease.owner}, not ${normalizedOwner}.`
    );
  }
  const parsedVersion = Number(expectedLeaseVersion);
  if (Number.isFinite(parsedVersion) && lease.version !== Math.trunc(parsedVersion)) {
    throw createQueueError(
      'QUEUE_LEASE_VERSION_MISMATCH',
      `Job ${job.id} lease version ${lease.version} did not match expected ${Math.trunc(parsedVersion)}.`
    );
  }
  return lease;
};

const isLeaseExpired = (job, nowMs, queueName = null) => {
  const leaseExpiresAt = Date.parse(job?.lease?.expiresAt || '');
  if (!Number.isNaN(leaseExpiresAt)) {
    return leaseExpiresAt <= nowMs;
  }
  const heartbeatAt = Date.parse(job?.lastHeartbeatAt || job?.startedAt || '');
  if (Number.isNaN(heartbeatAt)) return false;
  return (nowMs - heartbeatAt) > resolveLeaseDurationMs(job, queueName);
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
    jobs: Array.isArray(payload.jobs) ? payload.jobs.map((job) => normalizeJobRecord(job)) : []
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
      lease: {
        owner: null,
        version: 0,
        expiresAt: null,
        acquiredAt: null,
        renewedAt: null,
        releasedAt: null,
        releasedReason: null,
        lastOwner: null
      },
      transition: {
        sequence: 0,
        from: null,
        to: 'queued',
        at: normalizeIsoTimestamp(job.createdAt) || new Date().toISOString(),
        reason: 'enqueue'
      },
      logPath: path.join(logsDir, `${job.id}.log`),
      reportPath: path.join(reportsDir, `${job.id}.json`)
    };
    queue.jobs.push(next);
    await saveQueue(dirPath, queue, resolvedQueueName);
    return { ok: true, job: next };
  });
}

export async function claimNextJob(dirPath, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const { logsDir, reportsDir } = await ensureJobDirs(dirPath);
    const queue = await loadQueue(dirPath, queueName);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const job = queue.jobs.find((entry) => {
      if (entry.status !== 'queued') return false;
      if (!entry.nextEligibleAt) return true;
      const eligibleAt = Date.parse(entry.nextEligibleAt);
      return Number.isNaN(eligibleAt) || eligibleAt <= now;
    });
    if (!job) return null;
    if (!job.logPath) job.logPath = path.join(logsDir, `${job.id}.log`);
    if (!job.reportPath) job.reportPath = path.join(reportsDir, `${job.id}.json`);
    const previousStatus = assertAllowedTransition(job, 'running');
    job.status = 'running';
    job.startedAt = nowIso;
    job.finishedAt = null;
    job.lastHeartbeatAt = nowIso;
    job.nextEligibleAt = null;
    setLease(job, {
      ownerId: options.ownerId,
      leaseMs: options.leaseMs,
      at: nowIso,
      queueName,
      incrementVersion: true
    });
    recordTransition(job, previousStatus, 'running', 'claim', nowIso);
    await saveQueue(dirPath, queue, queueName);
    return job;
  });
}

export async function completeJob(dirPath, jobId, status, result, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const { reportsDir } = await ensureJobDirs(dirPath);
    const queue = await loadQueue(dirPath, queueName);
    const job = queue.jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    const nextStatus = VALID_JOB_STATUSES.has(status) ? status : null;
    if (!nextStatus) {
      throw createQueueError('QUEUE_INVALID_STATUS', `Unsupported queue status "${status}".`);
    }
    const previousStatus = assertAllowedTransition(job, nextStatus);
    assertLeaseOwnership(job, {
      ownerId: options.ownerId,
      expectedLeaseVersion: options.expectedLeaseVersion
    });
    const nowIso = new Date().toISOString();
    job.status = nextStatus;
    job.result = result || null;
    if (Number.isFinite(result?.attempts)) {
      job.attempts = Math.max(0, Math.floor(result.attempts));
    }
    if (result?.error) {
      job.lastError = result.error;
    }
    if (nextStatus === 'queued') {
      job.startedAt = null;
      job.finishedAt = null;
      if (result?.retry === true) {
        job.nextEligibleAt = normalizeIsoTimestamp(result?.nextEligibleAt)
          || new Date(Date.now() + resolveRetryDelayMs(job.attempts)).toISOString();
      } else {
        job.nextEligibleAt = null;
      }
    } else {
      job.finishedAt = nowIso;
      job.nextEligibleAt = null;
    }
    job.lastHeartbeatAt = null;
    clearLease(job, nowIso, nextStatus === 'queued' ? 'retry' : 'complete');
    recordTransition(job, previousStatus, nextStatus, nextStatus === 'queued' ? 'retry' : 'complete', nowIso);
    await saveQueue(dirPath, queue, queueName);
    const reportPath = job.reportPath || path.join(reportsDir, `${job.id}.json`);
    try {
      await atomicWriteJson(reportPath, {
        updatedAt: nowIso,
        status: job.status,
        job
      }, { spaces: 2 });
    } catch {}
    return job;
  });
}

export async function touchJobHeartbeat(dirPath, jobId, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath, queueName);
    const job = queue.jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    if (job.status !== 'running') return job;
    assertLeaseOwnership(job, {
      ownerId: options.ownerId,
      expectedLeaseVersion: options.expectedLeaseVersion
    });
    const nowIso = new Date().toISOString();
    job.lastHeartbeatAt = nowIso;
    setLease(job, {
      ownerId: options.ownerId || job.lease?.owner,
      leaseMs: options.leaseMs,
      at: nowIso,
      queueName,
      incrementVersion: false
    });
    await saveQueue(dirPath, queue, queueName);
    return job;
  });
}

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
      if (!isLeaseExpired(job, now, queueName)) continue;
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
      const nowIso = new Date(now).toISOString();
      if (nextAttempts <= maxRetries) {
        retried += 1;
        const previousStatus = assertAllowedTransition(job, 'queued');
        job.status = 'queued';
        job.attempts = nextAttempts;
        job.lastError = 'lease expired before completion';
        const delayMs = resolveRetryDelayMs(nextAttempts);
        job.nextEligibleAt = new Date(now + delayMs).toISOString();
        job.startedAt = null;
        job.finishedAt = null;
        clearLease(job, nowIso, 'lease-expired-retry');
        recordTransition(job, previousStatus, 'queued', 'lease-expired-retry', nowIso);
      } else {
        failed += 1;
        const previousStatus = assertAllowedTransition(job, 'failed');
        job.status = 'failed';
        job.finishedAt = nowIso;
        job.nextEligibleAt = null;
        job.result = { error: 'lease expired before completion', attempts: nextAttempts };
        clearLease(job, nowIso, 'lease-expired-fail');
        recordTransition(job, previousStatus, 'failed', 'lease-expired-fail', nowIso);
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
