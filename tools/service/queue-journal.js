import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText } from '../../src/shared/io/atomic-write.js';

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
  const ts = typeof at === 'string' && at.trim() ? at.trim() : new Date().toISOString();
  return {
    ts,
    eventType,
    target,
    queueName: queueName || job?.queueName || 'index',
    jobId: job?.id || null,
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
  await fs.mkdir(dirPath, { recursive: true });
  const journalPath = getQueueJournalPath(dirPath, queueName);
  const payload = entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
  await fs.appendFile(journalPath, payload, 'utf8');
}

export async function saveQueueJournal(dirPath, queueName = null, entries = []) {
  await fs.mkdir(dirPath, { recursive: true });
  const journalPath = getQueueJournalPath(dirPath, queueName);
  const payload = Array.isArray(entries) && entries.length
    ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    : '';
  await atomicWriteText(journalPath, payload, { newline: false });
}

export async function loadQueueJournal(dirPath, queueName = null) {
  const journalPath = getQueueJournalPath(dirPath, queueName);
  try {
    const raw = await fs.readFile(journalPath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function replayQueueJournal(entries = []) {
  const queueJobs = new Map();
  const quarantineJobs = new Map();
  for (const entry of entries) {
    const jobId = typeof entry?.jobId === 'string' && entry.jobId.trim() ? entry.jobId.trim() : null;
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
