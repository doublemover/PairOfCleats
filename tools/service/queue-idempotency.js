import path from 'node:path';
import { stableStringifyForSignature } from '../../src/shared/stable-json.js';
import { sha1 } from '../../src/shared/hash.js';

const normalizeString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeIdentityPath = (value) => {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  const looksLikePath = path.isAbsolute(trimmed)
    || trimmed.startsWith('.')
    || trimmed.includes(path.sep)
    || trimmed.includes('/')
    || trimmed.includes('\\');
  const normalized = looksLikePath ? path.resolve(trimmed) : trimmed;
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

export function buildQueueJobIdempotencyPayload(job = {}, queueName = null) {
  return {
    queueName: normalizeString(queueName || job?.queueName || 'index') || 'index',
    repo: normalizeIdentityPath(job?.repo),
    repoRoot: normalizeIdentityPath(job?.repoRoot || job?.repo),
    reason: normalizeString(job?.reason),
    stage: normalizeString(job?.stage),
    mode: normalizeString(job?.mode),
    buildId: normalizeString(job?.buildId),
    buildRoot: normalizeIdentityPath(job?.buildRoot),
    indexDir: normalizeIdentityPath(job?.indexDir),
    indexRoot: normalizeIdentityPath(job?.indexRoot),
    configHash: normalizeString(job?.configHash),
    repoProvenance: normalizeString(job?.repoProvenance),
    embeddingPlanDigest: normalizeString(job?.embeddingPlan?.digest),
    embeddingIdentityKey: normalizeString(job?.embeddingIdentityKey),
    embeddingPayloadFormatVersion: normalizeQueueEmbeddingPayloadVersion(job?.embeddingPayloadFormatVersion),
    args: Array.isArray(job?.args) && job.args.length ? job.args : null
  };
}

export function buildQueueJobIdempotencyKey(job = {}, queueName = null) {
  const payload = buildQueueJobIdempotencyPayload(job, queueName);
  return `qjob2-${sha1(stableStringifyForSignature(payload))}`;
}

export const normalizeQueueEmbeddingPayloadVersion = value => value == null || value === '' ? null
  : Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : null;

export const resolveQueueIdempotencySource = job => {
  if (['explicit', 'derived', 'legacy-derived'].includes(job?.idempotencySource)) return job.idempotencySource;
  if (!normalizeString(job?.idempotencyKey)) return 'derived';
  return /^qjob[12]-[a-f0-9]{40}$/.test(job.idempotencyKey) ? 'legacy-derived' : 'explicit';
};

const identityKeys = job => {
  const original = normalizeString(job?.idempotencyKey);
  if (original && resolveQueueIdempotencySource(job) === 'explicit') return [original];
  return [...new Set([original, buildQueueJobIdempotencyKey(job, job?.queueName)].filter(Boolean))];
};

export const queueJobsShareIdempotency = (left, right) => {
  const keys = new Set(identityKeys(left));
  return identityKeys(right).some(key => keys.has(key));
};

/** Retained legacy keys and canonical derived identities are aliases, not new jobs. */
export const groupQueueJobsByIdempotency = jobs => {
  const aliases = new Map(), groups = new Set();
  for (const job of jobs) {
    const keys = identityKeys(job);
    const matches = [...new Set(keys.map(key => aliases.get(key)).filter(Boolean))]
      .sort((left, right) => right.keys.size - left.keys.size);
    const group = matches[0] || { keys: new Set(), jobs: [], idempotencyKey: keys.at(-1) };
    groups.add(group);
    for (const other of matches.slice(1)) {
      group.jobs.push(...other.jobs);
      for (const key of other.keys) { group.keys.add(key); aliases.set(key, group); }
      groups.delete(other);
    }
    group.jobs.push(job);
    for (const key of keys) { group.keys.add(key); aliases.set(key, group); }
  }
  return [...groups].map(({ idempotencyKey, jobs: members }) => ({ idempotencyKey, jobs: members }));
};

/** Direct alias lookup for one locked claim snapshot, preserving queue order. */
export const createRunningQueueDuplicateLookup = (jobs) => {
  const byAlias = new Map();
  for (let order = 0; order < jobs.length; order += 1) {
    const job = jobs[order];
    if (job?.status !== 'running' || !job.idempotencyKey) continue;
    for (const key of identityKeys(job)) {
      const candidates = byAlias.get(key) || [];
      // One exclusion ID is queried; the first two distinct IDs suffice.
      if (candidates.length < 2 && !candidates.some(entry => entry.job.id === job.id)) candidates.push({ job, order });
      byAlias.set(key, candidates);
    }
  }
  return (job) => {
    let found = null;
    for (const key of identityKeys(job)) {
      const candidate = byAlias.get(key)?.find(entry => entry.job.id !== job.id);
      if (candidate && (!found || candidate.order < found.order)) found = candidate;
    }
    return found?.job || null;
  };
};
