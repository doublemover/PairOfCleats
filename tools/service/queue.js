import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { acquireFileLock } from '../../src/shared/locks/file-lock.js';
import { atomicWriteJson } from '../../src/shared/io/atomic-write.js';
import { resolveQueueLeasePolicy } from './lease-policy.js';
import { buildQueueJobIdempotencyKey } from './queue-idempotency.js';

const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000;
const VALID_JOB_STATUSES = new Set(['queued', 'running', 'done', 'failed']);
const ALLOWED_TRANSITIONS = Object.freeze({
  queued: new Set(['running', 'failed']),
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
      : null,
    policy: resolveQueueLeasePolicy({
      job,
      queueName: job?.queueName || null,
      overrides: job?.lease?.policy || null
    })
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
  const rawMaxRetries = job?.maxRetries;
  const maxRetries = rawMaxRetries === null || rawMaxRetries === undefined || rawMaxRetries === ''
    ? null
    : (Number.isFinite(Number(rawMaxRetries))
      ? Math.max(0, Math.trunc(Number(rawMaxRetries)))
      : null);
  const normalized = {
    ...job,
    status,
    attempts,
    maxRetries,
    nextEligibleAt: normalizeIsoTimestamp(job?.nextEligibleAt || null),
    createdAt: normalizeIsoTimestamp(job?.createdAt || null) || new Date().toISOString(),
    startedAt: normalizeIsoTimestamp(job?.startedAt || null),
    finishedAt: normalizeIsoTimestamp(job?.finishedAt || null),
    lastHeartbeatAt: normalizeIsoTimestamp(job?.lastHeartbeatAt || null),
    progress: {
      sequence: Number.isFinite(Number(job?.progress?.sequence))
        ? Math.max(0, Math.trunc(Number(job.progress.sequence)))
        : 0,
      updatedAt: normalizeIsoTimestamp(job?.progress?.updatedAt || null),
      kind: typeof job?.progress?.kind === 'string' && job.progress.kind.trim()
        ? job.progress.kind.trim()
        : null,
      note: typeof job?.progress?.note === 'string' && job.progress.note.trim()
        ? job.progress.note.trim()
        : null
    },
    lease: normalizeLease(job),
    transition: normalizeTransition(job, status)
  };
  normalized.idempotencyKey = typeof job?.idempotencyKey === 'string' && job.idempotencyKey.trim()
    ? job.idempotencyKey.trim()
    : buildQueueJobIdempotencyKey(normalized, normalized.queueName || null);
  return normalized;
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

const resolveLeasePolicy = (job, queueName = null, options = {}) => resolveQueueLeasePolicy({
  job,
  queueName,
  overrides: {
    leaseMs: options.leaseMs,
    renewIntervalMs: options.renewIntervalMs,
    progressIntervalMs: options.progressIntervalMs
  }
});

const setLease = (job, {
  ownerId,
  at,
  queueName,
  incrementVersion = false,
  leaseMs = null,
  renewIntervalMs = null,
  progressIntervalMs = null
}) => {
  const lease = normalizeLease(job);
  const owner = normalizeLeaseOwner(ownerId);
  const policy = resolveLeasePolicy(job, queueName, {
    leaseMs,
    renewIntervalMs,
    progressIntervalMs
  });
  lease.owner = owner;
  lease.version = incrementVersion ? lease.version + 1 : Math.max(1, lease.version);
  lease.acquiredAt = incrementVersion ? at : (lease.acquiredAt || at);
  lease.renewedAt = at;
  lease.expiresAt = new Date(Date.parse(at) + policy.leaseMs).toISOString();
  lease.releasedAt = null;
  lease.releasedReason = null;
  lease.policy = policy;
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

const recordProgress = (job, { at, kind, note = null }) => {
  const current = job?.progress && typeof job.progress === 'object'
    ? job.progress
    : { sequence: 0, updatedAt: null, kind: null, note: null };
  job.progress = {
    sequence: Number.isFinite(Number(current.sequence))
      ? Math.max(0, Math.trunc(Number(current.sequence))) + 1
      : 1,
    updatedAt: at,
    kind,
    note
  };
};

const isActiveJobStatus = (status) => status === 'queued' || status === 'running';

const findActiveDuplicateJob = (jobs, idempotencyKey, excludeJobId = null) => jobs.find((entry) => (
  entry.id !== excludeJobId
  && entry.idempotencyKey
  && entry.idempotencyKey === idempotencyKey
  && isActiveJobStatus(entry.status)
));

const suppressQueuedDuplicateJob = (job, { at, duplicateOfJob, reason }) => {
  if (!job || job.status !== 'queued') return false;
  const previousStatus = assertAllowedTransition(job, 'failed');
  job.status = 'failed';
  job.finishedAt = at;
  job.nextEligibleAt = null;
  job.lastHeartbeatAt = null;
  job.lastError = 'duplicate logical job suppressed';
  job.result = {
    error: 'duplicate logical job suppressed',
    duplicateOfId: duplicateOfJob?.id || null,
    duplicateOfIdempotencyKey: duplicateOfJob?.idempotencyKey || job.idempotencyKey || null,
    reason
  };
  clearLease(job, at, reason);
  recordProgress(job, { at, kind: 'failed', note: reason });
  recordTransition(job, previousStatus, 'failed', reason, at);
  return true;
};

const suppressClaimSideDuplicates = (queue, claimedJob, nowIso) => {
  if (!claimedJob?.idempotencyKey) return 0;
  let suppressed = 0;
  for (const entry of queue.jobs) {
    if (entry.id === claimedJob.id) continue;
    if (entry.status !== 'queued') continue;
    if (entry.idempotencyKey !== claimedJob.idempotencyKey) continue;
    if (suppressQueuedDuplicateJob(entry, {
      at: nowIso,
      duplicateOfJob: claimedJob,
      reason: 'duplicate-claim-suppressed'
    })) {
      suppressed += 1;
    }
  }
  return suppressed;
};

const isLeaseExpired = (job, nowMs, queueName = null) => {
  const leaseExpiresAt = Date.parse(job?.lease?.expiresAt || '');
  if (!Number.isNaN(leaseExpiresAt)) {
    return leaseExpiresAt <= nowMs;
  }
  const heartbeatAt = Date.parse(job?.lastHeartbeatAt || job?.startedAt || '');
  if (Number.isNaN(heartbeatAt)) return false;
  return (nowMs - heartbeatAt) > resolveLeasePolicy(job, queueName).leaseMs;
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

const createQueueJobId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

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

export function getQuarantinePaths(dirPath, queueName = null) {
  const normalized = normalizeQueueName(queueName);
  const suffix = normalized ? `-${normalized}` : '';
  return {
    quarantinePath: path.join(dirPath, `quarantine${suffix}.json`)
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

const normalizeQuarantineState = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'retried') return 'retried';
  return 'quarantined';
};

const normalizeQuarantineMetadata = (job = {}) => {
  const quarantine = job?.quarantine && typeof job.quarantine === 'object'
    ? job.quarantine
    : {};
  return {
    state: normalizeQuarantineState(quarantine.state),
    quarantinedAt: normalizeIsoTimestamp(quarantine.quarantinedAt || job?.finishedAt || job?.createdAt || null),
    reason: typeof quarantine.reason === 'string' && quarantine.reason.trim()
      ? quarantine.reason.trim()
      : null,
    sourceStatus: typeof quarantine.sourceStatus === 'string' && quarantine.sourceStatus.trim()
      ? quarantine.sourceStatus.trim()
      : job?.status || 'failed',
    sourceQueueName: typeof quarantine.sourceQueueName === 'string' && quarantine.sourceQueueName.trim()
      ? quarantine.sourceQueueName.trim()
      : (job?.queueName || 'index'),
    releasedAt: normalizeIsoTimestamp(quarantine.releasedAt || null),
    releaseReason: typeof quarantine.releaseReason === 'string' && quarantine.releaseReason.trim()
      ? quarantine.releaseReason.trim()
      : null,
    retryJobId: typeof quarantine.retryJobId === 'string' && quarantine.retryJobId.trim()
      ? quarantine.retryJobId.trim()
      : null
  };
};

const applyQuarantineMetadata = (job, {
  at,
  reason,
  sourceStatus = null,
  sourceQueueName = null,
  state = 'quarantined',
  releasedAt = null,
  releaseReason = null,
  retryJobId = null
}) => {
  job.quarantine = {
    state: normalizeQuarantineState(state),
    quarantinedAt: at,
    reason,
    sourceStatus: sourceStatus || job.status,
    sourceQueueName: sourceQueueName || job.queueName || 'index',
    releasedAt: normalizeIsoTimestamp(releasedAt || null),
    releaseReason: typeof releaseReason === 'string' && releaseReason.trim()
      ? releaseReason.trim()
      : null,
    retryJobId: typeof retryJobId === 'string' && retryJobId.trim()
      ? retryJobId.trim()
      : null
  };
};

export async function loadQuarantine(dirPath, queueName = null) {
  const { quarantinePath } = getQuarantinePaths(dirPath, queueName);
  const payload = await readJson(quarantinePath, { jobs: [] });
  return {
    jobs: Array.isArray(payload.jobs)
      ? payload.jobs.map((job) => {
        const normalized = normalizeJobRecord(job);
        normalized.quarantine = normalizeQuarantineMetadata(normalized);
        return normalized;
      })
      : []
  };
}

export async function saveQuarantine(dirPath, quarantine, queueName = null) {
  const { quarantinePath } = getQuarantinePaths(dirPath, queueName);
  await atomicWriteJson(quarantinePath, quarantine, { spaces: 2 });
}

const createQueuedJobRecord = (job, {
  logsDir,
  reportsDir,
  resolvedQueueName,
  idempotencyKey
}) => {
  const maxRetries = Number.isFinite(Number(job.maxRetries)) && Number(job.maxRetries) >= 0
    ? Math.floor(Number(job.maxRetries))
    : null;
  return normalizeJobRecord({
    id: job.id,
    createdAt: job.createdAt,
    status: 'queued',
    queueName: resolvedQueueName || 'index',
    repo: job.repo,
    repoRoot: job.repoRoot || job.repo || null,
    mode: job.mode,
    reason: job.reason || null,
    stage: job.stage || null,
    buildId: job.buildId || null,
    buildRoot: job.buildRoot || null,
    indexDir: job.indexDir || null,
    indexRoot: job.indexRoot || null,
    idempotencyKey,
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
    progress: {
      sequence: 0,
      updatedAt: null,
      kind: null,
      note: null
    },
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
  });
};

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
 * @param {{forceDuplicate?:boolean}} [options={}]
 * @returns {Promise<{ok:boolean,job?:object,message?:string,duplicate?:boolean,replaySuppressed?:boolean,idempotencyKey?:string}>}
 */
export async function enqueueJob(dirPath, job, maxQueued = null, queueName = null, options = {}) {
  await ensureQueueDir(dirPath);
  const { logsDir, reportsDir } = await ensureJobDirs(dirPath);
  const resolvedQueueName = resolveQueueName(queueName, job);
  const { lockPath } = getQueuePaths(dirPath, resolvedQueueName);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath, resolvedQueueName);
    const idempotencyKey = buildQueueJobIdempotencyKey(job, resolvedQueueName || 'index');
    if (options.forceDuplicate !== true) {
      const duplicate = findActiveDuplicateJob(queue.jobs, idempotencyKey);
      if (duplicate) {
        return {
          ok: true,
          duplicate: true,
          replaySuppressed: true,
          message: 'Duplicate logical job suppressed.',
          job: duplicate,
          idempotencyKey
        };
      }
    }
    const queued = queue.jobs.filter((entry) => entry.status === 'queued');
    if (Number.isFinite(maxQueued) && queued.length >= maxQueued) {
      return { ok: false, message: 'Queue is full.' };
    }
    const next = createQueuedJobRecord(job, {
      logsDir,
      reportsDir,
      resolvedQueueName,
      idempotencyKey
    });
    queue.jobs.push(next);
    await saveQueue(dirPath, queue, resolvedQueueName);
    return { ok: true, job: next, idempotencyKey };
  });
}

export async function claimNextJob(dirPath, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const { logsDir, reportsDir } = await ensureJobDirs(dirPath);
    const queue = await loadQueue(dirPath, queueName);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let job = null;
    for (const entry of queue.jobs) {
      if (entry.status !== 'queued') continue;
      if (entry.idempotencyKey) {
        const runningDuplicate = findActiveDuplicateJob(queue.jobs, entry.idempotencyKey, entry.id);
        if (runningDuplicate?.status === 'running') {
          suppressQueuedDuplicateJob(entry, {
            at: nowIso,
            duplicateOfJob: runningDuplicate,
            reason: 'duplicate-running-suppressed'
          });
          continue;
        }
      }
      if (!entry.nextEligibleAt) {
        job = entry;
        break;
      }
      const eligibleAt = Date.parse(entry.nextEligibleAt);
      if (Number.isNaN(eligibleAt) || eligibleAt <= now) {
        job = entry;
        break;
      }
    }
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
      renewIntervalMs: options.renewIntervalMs,
      progressIntervalMs: options.progressIntervalMs,
      at: nowIso,
      queueName,
      incrementVersion: true
    });
    recordProgress(job, { at: nowIso, kind: 'claim', note: 'lease-acquired' });
    recordTransition(job, previousStatus, 'running', 'claim', nowIso);
    suppressClaimSideDuplicates(queue, job, nowIso);
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
    recordProgress(job, {
      at: nowIso,
      kind: nextStatus === 'queued' ? 'retry' : 'complete',
      note: nextStatus
    });
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

export async function quarantineJob(dirPath, jobId, reason, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const { reportsDir } = await ensureJobDirs(dirPath);
    const queue = await loadQueue(dirPath, queueName);
    const quarantine = await loadQuarantine(dirPath, queueName);
    const jobIndex = queue.jobs.findIndex((entry) => entry.id === jobId);
    if (jobIndex < 0) return null;
    const job = queue.jobs[jobIndex];
    if (job.status === 'running') {
      assertLeaseOwnership(job, {
        ownerId: options.ownerId,
        expectedLeaseVersion: options.expectedLeaseVersion
      });
    }
    const nowIso = new Date().toISOString();
    const quarantineReason = typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'quarantined';
    const sourceStatus = options.sourceStatus || job.status || 'failed';
    if (job.status !== 'failed') {
      const previousStatus = assertAllowedTransition(job, 'failed');
      job.status = 'failed';
      job.finishedAt = nowIso;
      job.nextEligibleAt = null;
      job.lastHeartbeatAt = null;
      clearLease(job, nowIso, quarantineReason);
      recordProgress(job, { at: nowIso, kind: 'quarantine', note: quarantineReason });
      recordTransition(job, previousStatus, 'failed', quarantineReason, nowIso);
    } else {
      job.finishedAt = normalizeIsoTimestamp(job.finishedAt || nowIso) || nowIso;
      job.nextEligibleAt = null;
      job.lastHeartbeatAt = null;
      clearLease(job, nowIso, quarantineReason);
      recordProgress(job, { at: nowIso, kind: 'quarantine', note: quarantineReason });
    }
    const resultPayload = options.result && typeof options.result === 'object'
      ? { ...options.result }
      : {};
    if (!resultPayload.error) {
      resultPayload.error = job.lastError || quarantineReason;
    }
    job.result = {
      ...(job.result && typeof job.result === 'object' ? job.result : {}),
      ...resultPayload
    };
    job.lastError = resultPayload.error || quarantineReason;
    applyQuarantineMetadata(job, {
      at: nowIso,
      reason: quarantineReason,
      sourceStatus,
      sourceQueueName: queueName || job.queueName || 'index'
    });
    queue.jobs.splice(jobIndex, 1);
    const existingIndex = quarantine.jobs.findIndex((entry) => entry.id === job.id);
    if (existingIndex >= 0) {
      quarantine.jobs[existingIndex] = job;
    } else {
      quarantine.jobs.push(job);
    }
    await saveQueue(dirPath, queue, queueName);
    await saveQuarantine(dirPath, quarantine, queueName);
    const reportPath = job.reportPath || path.join(reportsDir, `${job.id}.json`);
    try {
      await atomicWriteJson(reportPath, {
        updatedAt: nowIso,
        status: job.status,
        quarantined: true,
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
    const lastHeartbeatMs = Date.parse(job.lastHeartbeatAt || '');
    const minIntervalMs = Number(options.minIntervalMs);
    if (
      Number.isFinite(minIntervalMs)
      && minIntervalMs > 0
      && !Number.isNaN(lastHeartbeatMs)
      && (Date.now() - lastHeartbeatMs) < Math.trunc(minIntervalMs)
    ) {
      return job;
    }
    job.lastHeartbeatAt = nowIso;
    setLease(job, {
      ownerId: options.ownerId || job.lease?.owner,
      leaseMs: options.leaseMs,
      renewIntervalMs: options.renewIntervalMs,
      progressIntervalMs: options.progressIntervalMs,
      at: nowIso,
      queueName,
      incrementVersion: false
    });
    recordProgress(job, {
      at: nowIso,
      kind: options.progress?.kind || 'renewal',
      note: options.progress?.note || null
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
 * @returns {Promise<{stale:number,retried:number,failed:number,quarantined:number}>}
 */
export async function requeueStaleJobs(dirPath, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const queue = await loadQueue(dirPath, queueName);
    const quarantine = await loadQuarantine(dirPath, queueName);
    const now = Date.now();
    const stale = [];
    for (const job of queue.jobs) {
      if (job.status !== 'running') continue;
      if (!isLeaseExpired(job, now, queueName)) continue;
      stale.push(job);
    }
    if (!stale.length) return { stale: 0, retried: 0, failed: 0, quarantined: 0 };
    let retried = 0;
    let failed = 0;
    let quarantined = 0;
    const quarantinedIds = new Set();
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
        recordProgress(job, { at: nowIso, kind: 'retry', note: 'lease-expired' });
        recordTransition(job, previousStatus, 'queued', 'lease-expired-retry', nowIso);
      } else {
        failed += 1;
        quarantined += 1;
        const previousStatus = assertAllowedTransition(job, 'failed');
        job.status = 'failed';
        job.attempts = nextAttempts;
        job.finishedAt = nowIso;
        job.nextEligibleAt = null;
        job.lastError = 'lease expired before completion';
        job.result = { error: 'lease expired before completion', attempts: nextAttempts };
        clearLease(job, nowIso, 'lease-expired-fail');
        recordProgress(job, { at: nowIso, kind: 'quarantine', note: 'lease-expired-fail' });
        recordTransition(job, previousStatus, 'failed', 'lease-expired-fail', nowIso);
        applyQuarantineMetadata(job, {
          at: nowIso,
          reason: 'lease-expired-fail',
          sourceStatus: 'running',
          sourceQueueName: queueName || job.queueName || 'index'
        });
        const existingIndex = quarantine.jobs.findIndex((entry) => entry.id === job.id);
        if (existingIndex >= 0) {
          quarantine.jobs[existingIndex] = job;
        } else {
          quarantine.jobs.push(job);
        }
        quarantinedIds.add(job.id);
      }
      job.lastHeartbeatAt = null;
    }
    if (quarantinedIds.size > 0) {
      queue.jobs = queue.jobs.filter((job) => !quarantinedIds.has(job.id));
      await saveQuarantine(dirPath, quarantine, queueName);
    }
    await saveQueue(dirPath, queue, queueName);
    return { stale: stale.length, retried, failed, quarantined };
  });
}

export async function quarantineSummary(dirPath, queueName = null) {
  const { quarantinePath } = getQuarantinePaths(dirPath, queueName);
  if (!fsSync.existsSync(quarantinePath)) {
    return { total: 0, quarantined: 0, retried: 0 };
  }
  const quarantine = await loadQuarantine(dirPath, queueName);
  const summary = { total: quarantine.jobs.length, quarantined: 0, retried: 0 };
  for (const job of quarantine.jobs) {
    if (job.quarantine?.state === 'retried') summary.retried += 1;
    else summary.quarantined += 1;
  }
  return summary;
}

export async function retryQuarantinedJob(dirPath, jobId, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    await ensureQueueDir(dirPath);
    const { logsDir, reportsDir } = await ensureJobDirs(dirPath);
    const resolvedQueueName = resolveQueueName(queueName, null);
    const queue = await loadQueue(dirPath, resolvedQueueName);
    const quarantine = await loadQuarantine(dirPath, resolvedQueueName);
    const quarantinedJob = quarantine.jobs.find((entry) => (
      entry.id === jobId
      && (entry.quarantine?.state || 'quarantined') === 'quarantined'
    ));
    if (!quarantinedJob) return null;
    const idempotencyKey = buildQueueJobIdempotencyKey(quarantinedJob, resolvedQueueName || 'index');
    if (options.forceDuplicate !== true) {
      const duplicate = findActiveDuplicateJob(queue.jobs, idempotencyKey);
      if (duplicate) {
        return {
          ok: true,
          duplicate: true,
          replaySuppressed: true,
          message: 'Duplicate logical job suppressed.',
          job: duplicate,
          idempotencyKey,
          quarantinedJob
        };
      }
    }
    const nextJob = createQueuedJobRecord({
      ...quarantinedJob,
      id: createQueueJobId(),
      createdAt: new Date().toISOString()
    }, {
      logsDir,
      reportsDir,
      resolvedQueueName,
      idempotencyKey
    });
    queue.jobs.push(nextJob);
    applyQuarantineMetadata(quarantinedJob, {
      at: quarantinedJob.quarantine?.quarantinedAt || new Date().toISOString(),
      reason: quarantinedJob.quarantine?.reason || quarantinedJob.lastError || 'quarantined',
      sourceStatus: quarantinedJob.quarantine?.sourceStatus || quarantinedJob.status || 'failed',
      sourceQueueName: quarantinedJob.quarantine?.sourceQueueName || resolvedQueueName || 'index',
      state: 'retried',
      releasedAt: new Date().toISOString(),
      releaseReason: 'manual-retry',
      retryJobId: nextJob.id
    });
    await saveQueue(dirPath, queue, resolvedQueueName);
    await saveQuarantine(dirPath, quarantine, resolvedQueueName);
    return {
      ok: true,
      job: nextJob,
      idempotencyKey,
      retriedFromId: quarantinedJob.id,
      quarantinedJob
    };
  });
}

export async function purgeQuarantinedJobs(dirPath, queueName = null, options = {}) {
  const { lockPath } = getQueuePaths(dirPath, queueName);
  return withLock(lockPath, async () => {
    const quarantine = await loadQuarantine(dirPath, queueName);
    const before = quarantine.jobs.length;
    if (options.jobId) {
      quarantine.jobs = quarantine.jobs.filter((entry) => entry.id !== options.jobId);
    } else if (options.all === true) {
      quarantine.jobs = [];
    } else {
      return { removed: 0, jobs: quarantine.jobs };
    }
    await saveQuarantine(dirPath, quarantine, queueName);
    return {
      removed: before - quarantine.jobs.length,
      jobs: quarantine.jobs
    };
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
