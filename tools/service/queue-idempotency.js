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
    repoRoot: normalizeIdentityPath(job?.repoRoot),
    reason: normalizeString(job?.reason),
    stage: normalizeString(job?.stage),
    mode: normalizeString(job?.mode),
    buildId: normalizeString(job?.buildId),
    buildRoot: normalizeIdentityPath(job?.buildRoot),
    indexDir: normalizeIdentityPath(job?.indexDir),
    indexRoot: normalizeIdentityPath(job?.indexRoot),
    configHash: normalizeString(job?.configHash),
    repoProvenance: normalizeString(job?.repoProvenance),
    embeddingIdentityKey: normalizeString(job?.embeddingIdentityKey),
    embeddingPayloadFormatVersion: Number.isFinite(Number(job?.embeddingPayloadFormatVersion))
      ? Math.max(1, Math.floor(Number(job.embeddingPayloadFormatVersion)))
      : null,
    args: Array.isArray(job?.args) && job.args.length ? job.args : null
  };
}

export function buildQueueJobIdempotencyKey(job = {}, queueName = null) {
  const payload = buildQueueJobIdempotencyPayload(job, queueName);
  return `qjob1-${sha1(stableStringifyForSignature(payload))}`;
}
