import fsSync from 'node:fs';
import path from 'node:path';
import { toPosix } from '../../../../shared/files.js';
import { buildMetaPathScopeKey } from './path-normalization.js';

const GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT = 3;
const GIT_META_TIMEOUT_MAX_MS_DEFAULT = 45 * 1000;

const toFailureMessage = (value, maxLength = 220) => {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
    : normalized;
};

const toFailureCode = (value) => {
  const code = String(value || '').trim().toUpperCase();
  return code || null;
};

const isTimeoutLikeFailure = ({ code, message }) => (
  code === 'SUBPROCESS_TIMEOUT'
  || code === 'ABORT_ERR'
  || /timed?\s*out/i.test(String(message || ''))
);

const isFatalUnavailableFailure = ({ code, message }) => {
  const lower = String(message || '').toLowerCase();
  return code === 'ENOENT'
    || lower.includes('not a git repository')
    || lower.includes('git metadata unavailable')
    || lower.includes('is not recognized as an internal or external command')
    || lower.includes('spawn git');
};

/**
 * Collapse raw subprocess failures into the batch fallback classes.
 *
 * Timeout-like failures participate in adaptive retry/cooldown handling.
 * Fatal-unavailable failures short-circuit the whole fetch to
 * `{ ok:false, reason:'unavailable' }` at the provider boundary.
 *
 * @param {{err?:Error|null,result?:{exitCode?:number,stdout?:string,stderr?:string}|null}} input
 * @returns {{code:string|null,message:string|null,timeoutLike:boolean,fatalUnavailable:boolean}}
 */
export const createGitMetaBatchFailure = ({ err = null, result = null } = {}) => {
  const code = toFailureCode(
    err?.code
    || err?.cause?.code
    || (result?.exitCode != null ? `GIT_EXIT_${result.exitCode}` : '')
  );
  const message = toFailureMessage(
    err?.message
    || err?.cause?.message
    || result?.stderr
    || result?.stdout
    || ''
  );
  const timeoutLike = isTimeoutLikeFailure({ code, message });
  const fatalUnavailable = isFatalUnavailableFailure({ code, message });
  return {
    code,
    message: message || null,
    timeoutLike,
    fatalUnavailable
  };
};

const resolveFileSizeBytes = (repoRoot, filePosix) => {
  try {
    const absPath = path.join(repoRoot, filePosix);
    const stat = fsSync.statSync(absPath);
    const size = Number(stat?.size);
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch {
    return 0;
  }
};

export const resolveChunkCost = ({ repoRoot, chunk, timeoutState }) => {
  let maxBytes = 0;
  let totalBytes = 0;
  let count = 0;
  let maxTimeouts = 0;
  for (const filePosix of Array.isArray(chunk) ? chunk : []) {
    const normalized = toPosix(filePosix);
    if (!normalized) continue;
    const bytes = resolveFileSizeBytes(repoRoot, normalized);
    maxBytes = Math.max(maxBytes, bytes);
    totalBytes += bytes;
    count += 1;
    const bucket = timeoutState.get(buildMetaPathScopeKey(repoRoot, normalized));
    const pathTimeouts = Number.isFinite(Number(bucket?.timeouts))
      ? Math.max(0, Math.floor(Number(bucket.timeouts)))
      : 0;
    maxTimeouts = Math.max(maxTimeouts, pathTimeouts);
  }
  const avgBytes = count > 0 ? Math.floor(totalBytes / count) : 0;
  const sizeTier = maxBytes >= 2 * 1024 * 1024
    ? 3
    : maxBytes >= 512 * 1024
      ? 2
      : maxBytes >= 128 * 1024
        ? 1
        : 0;
  const multiplier = Math.max(
    1,
    Math.min(
      4,
      1 + (sizeTier * 0.35) + Math.min(1.2, maxTimeouts * 0.2)
    )
  );
  return {
    maxBytes,
    avgBytes,
    sizeTier,
    maxTimeouts,
    multiplier
  };
};

/**
 * Build the timeout ladder for one chunk attempt loop.
 *
 * The ladder is monotonic and bounded by policy min/max values so retries
 * remain predictable. Prior timeout history and file-size cost increase the
 * number of attempts and upper timeout target, but we still clamp to policy
 * limits to avoid runaway retries.
 *
 * @param {object} input
 * @param {number} input.baseTimeoutMs
 * @param {object} input.timeoutPolicy
 * @param {{multiplier?:number,sizeTier?:number,maxTimeouts?:number}} input.chunkCost
 * @returns {number[]}
 */
export const resolveTimeoutPlan = ({
  baseTimeoutMs,
  timeoutPolicy,
  chunkCost
}) => {
  const minTimeoutMs = Math.max(500, Math.floor(timeoutPolicy?.minTimeoutMs || 500));
  const maxTimeoutMs = Math.max(minTimeoutMs, Math.floor(timeoutPolicy?.maxTimeoutMs || GIT_META_TIMEOUT_MAX_MS_DEFAULT));
  const base = Number.isFinite(Number(baseTimeoutMs)) && Number(baseTimeoutMs) > 0
    ? Math.max(minTimeoutMs, Math.floor(Number(baseTimeoutMs)))
    : Math.max(minTimeoutMs, 15000);
  const target = Math.max(
    minTimeoutMs,
    Math.min(maxTimeoutMs, Math.floor(base * (chunkCost?.multiplier || 1)))
  );
  const attemptCap = Number.isFinite(Number(timeoutPolicy?.retryMaxAttempts))
    ? Math.max(1, Math.floor(Number(timeoutPolicy.retryMaxAttempts)))
    : GIT_META_TIMEOUT_RETRY_MAX_ATTEMPTS_DEFAULT;
  const adaptiveAttempts = 1 + Math.max(0, chunkCost?.sizeTier || 0) + Math.min(2, Math.max(0, chunkCost?.maxTimeouts || 0));
  const attempts = Math.max(1, Math.min(attemptCap, adaptiveAttempts));
  const ladder = [];
  for (let i = 0; i < attempts; i += 1) {
    const ratio = attempts <= 1 ? 1 : (0.6 + ((i / (attempts - 1)) * 0.4));
    const value = Math.max(minTimeoutMs, Math.min(maxTimeoutMs, Math.floor(target * ratio)));
    if (!ladder.includes(value)) ladder.push(value);
  }
  if (!ladder.length) ladder.push(target);
  return ladder;
};
