import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { isLockStale, isProcessAlive, readLockInfo } from '../../src/shared/locks/file-lock.js';
import { resolveQueueLeasePolicy } from './lease-policy.js';
import {
  getQueuePaths,
  loadQueue,
  loadQuarantine,
  purgeQuarantinedJobs,
  quarantineJob,
  retryQuarantinedJob
} from './queue.js';
import { getServiceShutdownPaths } from './shutdown-state.js';

const normalizeQueueName = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw || raw === 'index') return null;
  return raw.replace(/[^a-z0-9_-]+/g, '-');
};

const normalizePathValue = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return path.resolve(value);
};

const resolveLeaseOwnerPid = (ownerId) => {
  const match = typeof ownerId === 'string' ? ownerId.trim().match(/^pid:(\d+)$/i) : null;
  return match ? Number(match[1]) : null;
};

const readDirFiles = async (dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry?.isFile?.())
      .map((entry) => path.resolve(path.join(dirPath, entry.name)));
  } catch {
    return [];
  }
};

const collectReferencedArtifacts = (jobs = []) => {
  const logs = new Set();
  const reports = new Set();
  for (const job of jobs) {
    const logPath = normalizePathValue(job?.logPath);
    const reportPath = normalizePathValue(job?.reportPath);
    if (logPath) logs.add(logPath);
    if (reportPath) reports.add(reportPath);
  }
  return { logs, reports };
};

const createRepairError = (code, message, extra = null) => {
  const error = new Error(message);
  error.code = code;
  if (extra && typeof extra === 'object') {
    Object.assign(error, extra);
  }
  return error;
};

export function getRepairAuditPath(dirPath, queueName = null) {
  const normalized = normalizeQueueName(queueName);
  const suffix = normalized ? `-${normalized}` : '';
  return path.join(dirPath, `repair-events${suffix}.jsonl`);
}

export async function appendRepairAuditEntry(dirPath, queueName = null, payload = {}) {
  await fs.mkdir(dirPath, { recursive: true });
  const entry = {
    at: new Date().toISOString(),
    queueName: queueName || 'index',
    ...payload
  };
  await fs.appendFile(getRepairAuditPath(dirPath, queueName), `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

export function summarizeHeartbeatJob(job, nowMs = Date.now()) {
  const policy = resolveQueueLeasePolicy({
    job,
    queueName: job?.queueName || null
  });
  const ownerPid = resolveLeaseOwnerPid(job?.lease?.owner);
  const ownerAlive = ownerPid !== null ? isProcessAlive(ownerPid) : null;
  const lastHeartbeatMs = Date.parse(job?.lastHeartbeatAt || job?.startedAt || job?.createdAt || '');
  const expiresAtMs = Date.parse(job?.lease?.expiresAt || '');
  const effectiveExpiresAtMs = Number.isFinite(expiresAtMs)
    ? expiresAtMs
    : (Number.isFinite(lastHeartbeatMs) ? lastHeartbeatMs + policy.leaseMs : Number.NaN);
  const lastHeartbeatAgeMs = Number.isFinite(lastHeartbeatMs) ? Math.max(0, nowMs - lastHeartbeatMs) : null;
  const remainingLeaseMs = Number.isFinite(effectiveExpiresAtMs) ? (effectiveExpiresAtMs - nowMs) : null;
  let status = 'healthy';
  if (remainingLeaseMs !== null && remainingLeaseMs <= 0) {
    status = 'stale';
  } else if (ownerAlive === false) {
    status = 'orphaned';
  } else if (lastHeartbeatAgeMs !== null && lastHeartbeatAgeMs >= (policy.progressIntervalMs * 2)) {
    status = 'warning';
  }
  return {
    id: job?.id || null,
    status,
    queueName: job?.queueName || 'index',
    leaseOwner: job?.lease?.owner || null,
    leaseVersion: Number.isFinite(Number(job?.lease?.version)) ? Math.trunc(Number(job.lease.version)) : null,
    ownerPid,
    ownerAlive,
    lastHeartbeatAt: job?.lastHeartbeatAt || job?.startedAt || null,
    lastHeartbeatAgeMs,
    expiresAt: Number.isFinite(effectiveExpiresAtMs) ? new Date(effectiveExpiresAtMs).toISOString() : null,
    remainingLeaseMs,
    policy
  };
}

export async function describeRepairLocks(dirPath, queueName = null) {
  const queuePaths = getQueuePaths(dirPath, queueName);
  const shutdownPaths = getServiceShutdownPaths(dirPath, queueName);
  const targets = [
    { kind: 'queue', path: queuePaths.lockPath },
    { kind: 'shutdown', path: shutdownPaths.lockPath }
  ];
  const results = [];
  for (const target of targets) {
    const exists = fsSync.existsSync(target.path);
    const info = exists ? await readLockInfo(target.path) : null;
    const ownerPid = Number.isFinite(Number(info?.pid)) ? Number(info.pid) : null;
    const ownerAlive = ownerPid !== null ? isProcessAlive(ownerPid) : null;
    const stale = exists ? await isLockStale(target.path) : false;
    results.push({
      kind: target.kind,
      path: target.path,
      exists,
      stale,
      ownerPid,
      ownerAlive,
      safeToUnlock: exists && (stale || ownerAlive === false || !info),
      info
    });
  }
  return results;
}

export async function describeOrphanArtifacts(dirPath, queueName = null) {
  const [queue, quarantine] = await Promise.all([
    loadQueue(dirPath, queueName),
    loadQuarantine(dirPath, queueName)
  ]);
  const referenced = collectReferencedArtifacts([
    ...queue.jobs,
    ...quarantine.jobs
  ]);
  const logsDir = path.join(dirPath, 'logs');
  const reportsDir = path.join(dirPath, 'reports');
  const logFiles = await readDirFiles(logsDir);
  const reportFiles = await readDirFiles(reportsDir);
  return {
    logs: logFiles.filter((filePath) => !referenced.logs.has(filePath)),
    reports: reportFiles.filter((filePath) => !referenced.reports.has(filePath))
  };
}

export async function inspectRepairState(dirPath, queueName = null, { jobId = null } = {}) {
  const [queue, quarantine, locks, orphans] = await Promise.all([
    loadQueue(dirPath, queueName),
    loadQuarantine(dirPath, queueName),
    describeRepairLocks(dirPath, queueName),
    describeOrphanArtifacts(dirPath, queueName)
  ]);
  const runningJobs = queue.jobs.filter((job) => job?.status === 'running');
  const heartbeat = runningJobs.map((job) => summarizeHeartbeatJob(job));
  const staleJobs = heartbeat.filter((entry) => entry.status === 'stale' || entry.status === 'orphaned');
  const job = jobId
    ? (
      queue.jobs.find((entry) => entry.id === jobId)
      || quarantine.jobs.find((entry) => entry.id === jobId)
      || null
    )
    : null;
  return {
    queue: {
      total: queue.jobs.length,
      queued: queue.jobs.filter((entry) => entry.status === 'queued').length,
      running: runningJobs.length,
      failed: queue.jobs.filter((entry) => entry.status === 'failed').length,
      done: queue.jobs.filter((entry) => entry.status === 'done').length
    },
    quarantine: {
      total: quarantine.jobs.length,
      quarantined: quarantine.jobs.filter((entry) => (entry.quarantine?.state || 'quarantined') === 'quarantined').length,
      retried: quarantine.jobs.filter((entry) => entry.quarantine?.state === 'retried').length
    },
    heartbeat: {
      totalRunning: heartbeat.length,
      stale: staleJobs.length,
      jobs: heartbeat
    },
    locks,
    orphans: {
      logs: orphans.logs,
      reports: orphans.reports
    },
    ...(job ? { job } : {})
  };
}

export async function quarantineRepairJob(dirPath, queueName = null, {
  jobId,
  reason = 'operator-repair',
  dryRun = false,
  requestedBy = null
} = {}) {
  const queue = await loadQueue(dirPath, queueName);
  const job = queue.jobs.find((entry) => entry.id === jobId);
  if (!job) {
    throw createRepairError('QUEUE_JOB_NOT_FOUND', `Queue job not found: ${jobId}`);
  }
  const heartbeat = job.status === 'running' ? summarizeHeartbeatJob(job) : null;
  if (job.status === 'running' && heartbeat?.status === 'healthy') {
    throw createRepairError(
      'QUEUE_REPAIR_UNSAFE',
      `Refusing to quarantine healthy running job ${jobId}.`,
      { heartbeat }
    );
  }
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      action: 'quarantine',
      job,
      heartbeat
    };
  }
  const quarantined = await quarantineJob(dirPath, jobId, reason, queueName, {
    ownerId: job?.lease?.owner || null,
    expectedLeaseVersion: job?.lease?.version ?? null,
    sourceStatus: job.status || 'failed',
    result: {
      error: reason,
      repairedBy: requestedBy || `cli:${process.pid}`
    }
  });
  await appendRepairAuditEntry(dirPath, queueName, {
    action: 'quarantine',
    dryRun: false,
    requestedBy: requestedBy || `cli:${process.pid}`,
    reason,
    jobId,
    result: {
      quarantined: Boolean(quarantined),
      sourceStatus: job.status || null
    }
  });
  return {
    ok: true,
    dryRun: false,
    action: 'quarantine',
    job: quarantined,
    heartbeat
  };
}

export async function retryRepairJob(dirPath, queueName = null, {
  jobId,
  dryRun = false,
  requestedBy = null
} = {}) {
  const quarantine = await loadQuarantine(dirPath, queueName);
  const job = quarantine.jobs.find((entry) => entry.id === jobId);
  if (!job) {
    throw createRepairError('QUEUE_QUARANTINE_NOT_FOUND', `Quarantined job not found: ${jobId}`);
  }
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      action: 'retry',
      job
    };
  }
  const result = await retryQuarantinedJob(dirPath, jobId, queueName);
  await appendRepairAuditEntry(dirPath, queueName, {
    action: 'retry',
    dryRun: false,
    requestedBy: requestedBy || `cli:${process.pid}`,
    jobId,
    result: {
      retried: Boolean(result?.ok),
      retryJobId: result?.job?.id || null
    }
  });
  return {
    ok: true,
    dryRun: false,
    action: 'retry',
    ...result
  };
}

export async function purgeRepairJobs(dirPath, queueName = null, {
  jobId = null,
  purgeAll = false,
  dryRun = false,
  requestedBy = null
} = {}) {
  const quarantine = await loadQuarantine(dirPath, queueName);
  const candidates = purgeAll
    ? quarantine.jobs
    : quarantine.jobs.filter((entry) => entry.id === jobId);
  if (!purgeAll && !candidates.length) {
    throw createRepairError('QUEUE_QUARANTINE_NOT_FOUND', `Quarantined job not found: ${jobId}`);
  }
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      action: 'purge',
      candidates: candidates.map((entry) => entry.id)
    };
  }
  const result = await purgeQuarantinedJobs(dirPath, queueName, {
    jobId,
    all: purgeAll
  });
  await appendRepairAuditEntry(dirPath, queueName, {
    action: 'purge',
    dryRun: false,
    requestedBy: requestedBy || `cli:${process.pid}`,
    jobId: purgeAll ? null : jobId,
    result: {
      removed: result.removed,
      purgeAll
    }
  });
  return {
    ok: true,
    dryRun: false,
    action: 'purge',
    removed: result.removed,
    remaining: result.jobs.length
  };
}

export async function unlockRepairState(dirPath, queueName = null, {
  lockKind = 'all',
  dryRun = false,
  requestedBy = null
} = {}) {
  const lockTargets = await describeRepairLocks(dirPath, queueName);
  const filtered = lockTargets.filter((entry) => lockKind === 'all' || entry.kind === lockKind);
  const results = [];
  for (const entry of filtered) {
    const result = {
      ...entry,
      removed: false
    };
    if (!entry.exists || !entry.safeToUnlock || dryRun) {
      results.push(result);
      continue;
    }
    await fs.rm(entry.path, { force: true });
    result.removed = true;
    results.push(result);
  }
  if (!dryRun) {
    await appendRepairAuditEntry(dirPath, queueName, {
      action: 'unlock',
      dryRun: false,
      requestedBy: requestedBy || `cli:${process.pid}`,
      result: {
        lockKind,
        removed: results.filter((entry) => entry.removed).map((entry) => entry.kind)
      }
    });
  }
  return {
    ok: true,
    dryRun,
    action: 'unlock',
    results
  };
}

export async function cleanupOrphanArtifacts(dirPath, queueName = null, {
  dryRun = false,
  requestedBy = null
} = {}) {
  const orphans = await describeOrphanArtifacts(dirPath, queueName);
  const removed = {
    logs: [],
    reports: []
  };
  if (!dryRun) {
    for (const filePath of orphans.logs) {
      await fs.rm(filePath, { force: true });
      removed.logs.push(filePath);
    }
    for (const filePath of orphans.reports) {
      await fs.rm(filePath, { force: true });
      removed.reports.push(filePath);
    }
    await appendRepairAuditEntry(dirPath, queueName, {
      action: 'cleanup-orphans',
      dryRun: false,
      requestedBy: requestedBy || `cli:${process.pid}`,
      result: {
        removed
      }
    });
  }
  return {
    ok: true,
    dryRun,
    action: 'cleanup-orphans',
    orphans,
    removed
  };
}

export async function heartbeatStatusRepairState(dirPath, queueName = null) {
  const queue = await loadQueue(dirPath, queueName);
  const jobs = queue.jobs
    .filter((entry) => entry?.status === 'running')
    .map((entry) => summarizeHeartbeatJob(entry));
  return {
    ok: true,
    queue: queueName || 'index',
    summary: {
      total: jobs.length,
      healthy: jobs.filter((entry) => entry.status === 'healthy').length,
      warning: jobs.filter((entry) => entry.status === 'warning').length,
      stale: jobs.filter((entry) => entry.status === 'stale').length,
      orphaned: jobs.filter((entry) => entry.status === 'orphaned').length
    },
    jobs
  };
}
