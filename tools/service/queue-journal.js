import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';
import { normalizeObservability } from '../../src/shared/observability.js';
import { admitQueueJobPaths, assertQueueArtifactPath, assertQueueJobId } from './queue-authority.js';

const normalizeQueueName = (value) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw || raw === 'index') return null;
  return raw.replace(/[^a-z0-9_-]+/g, '-');
};

export function getQueueJournalPath(dirPath, queueName = null) {
  const normalized = normalizeQueueName(queueName);
  const suffix = normalized ? `-${normalized}` : '';
  return path.join(dirPath, `queue-events${suffix}.jsonl`);
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const admitJournalEntry = (entry, dirPath = null) => {
  if (entry?.jobId == null) {
    if (entry?.snapshot != null) throw new Error('Queue journal snapshot requires a job ID.');
    return entry;
  }
  const id = assertQueueJobId(entry.jobId);
  if (entry.snapshot != null) {
    if (!entry.snapshot || typeof entry.snapshot !== 'object' || Array.isArray(entry.snapshot)
      || entry.snapshot.id !== id) throw new Error('Queue journal job ID does not match its snapshot.');
    assertQueueJobId(entry.snapshot.id);
    if (dirPath) return { ...entry, snapshot: admitQueueJobPaths(dirPath, entry.snapshot) };
  }
  return entry;
};

export function createQueueJournalEntry({
  eventType,
  queueName = null,
  target = 'queue',
  reason = null,
  workerId = null,
  job = null,
  extra = null,
  at = null
}) {
  if (job) assertQueueJobId(job.id);
  const ts = typeof at === 'string' && at.trim() ? at.trim() : new Date().toISOString();
  return {
    ts,
    eventType,
    target,
    queueName: queueName || job?.queueName || 'index',
    jobId: job?.id || null,
    observability: job?.observability
      ? normalizeObservability(job.observability, {
        surface: 'service',
        operation: eventType,
        context: {
          queueName: queueName || job?.queueName || 'index',
          jobId: job?.id || null
        }
      })
      : null,
    idempotencyKey: job?.idempotencyKey || null,
    reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
    workerId: typeof workerId === 'string' && workerId.trim() ? workerId.trim() : null,
    lease: job?.lease
      ? {
        owner: job.lease.owner || null,
        version: Number.isFinite(Number(job.lease.version)) ? Math.trunc(Number(job.lease.version)) : null
      }
      : null,
    snapshot: job ? cloneJson(job) : null,
    extra: extra && typeof extra === 'object' ? cloneJson(extra) : null
  };
}

export async function appendQueueJournalEntries(dirPath, queueName = null, entries = []) {
  if (!Array.isArray(entries) || !entries.length) return;
  const admitted = entries.map(entry => admitJournalEntry(entry, dirPath));
  const journalPath = getQueueJournalPath(dirPath, queueName);
  assertQueueArtifactPath(dirPath, journalPath);
  await fs.mkdir(dirPath, { recursive: true });
  const payload = admitted.map((entry) => `${JSON.stringify(entry)}\n`).join('');
  await fs.appendFile(journalPath, payload, 'utf8');
}

export async function saveQueueJournal(dirPath, queueName = null, entries = []) {
  const journalPath = getQueueJournalPath(dirPath, queueName);
  assertQueueArtifactPath(dirPath, journalPath);
  const admitted = Array.isArray(entries) ? entries.map(entry => admitJournalEntry(entry, dirPath)) : [];
  await fs.mkdir(dirPath, { recursive: true });
  const payload = admitted.length
    ? `${admitted.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    : '';
  await atomicWriteText(journalPath, payload, { newline: false });
}

export async function loadQueueJournal(dirPath, queueName = null) {
  const journalPath = getQueueJournalPath(dirPath, queueName);
  assertQueueArtifactPath(dirPath, journalPath);
  try {
    const raw = await fs.readFile(journalPath, 'utf8');
    const entries = [];
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      entries.push(admitJournalEntry(parsed, dirPath));
    }
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function replayQueueJournal(entries = [], { dirPath = null } = {}) {
  const queueJobs = new Map();
  const quarantineJobs = new Map();
  for (const rawEntry of entries) {
    const entry = admitJournalEntry(rawEntry, dirPath);
    const jobId = entry?.jobId ?? null;
    if (!jobId) continue;
    const snapshot = entry?.snapshot && typeof entry.snapshot === 'object'
      ? cloneJson(entry.snapshot)
      : null;
    if (entry?.target === 'purge') {
      queueJobs.delete(jobId);
      quarantineJobs.delete(jobId);
      continue;
    }
    if (!snapshot) continue;
    if (entry?.target === 'quarantine') {
      quarantineJobs.set(jobId, snapshot);
      queueJobs.delete(jobId);
      continue;
    }
    queueJobs.set(jobId, snapshot);
  }
  return {
    queue: { jobs: Array.from(queueJobs.values()) },
    quarantine: { jobs: Array.from(quarantineJobs.values()) }
  };
}
