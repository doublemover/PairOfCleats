import { getHeapStatistics } from 'node:v8';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { readArtifactFailureField, retainArtifactReadFailure } from './json/fallback.js';

export const toJsonTooLargeError = (filePath, size, { cause, causePresent = false } = {}) => {
  const err = new Error(
    `JSON artifact too large to load (${size} bytes): ${filePath}`
  );
  err.code = 'ERR_JSON_TOO_LARGE';
  return causePresent ? addStorageFailureContext(err, {}, retainArtifactReadFailure(cause), { secondaryPresent: true }) : err;
};

export const shouldTreatAsTooLarge = (err) => {
  const code = readArtifactFailureField(err, 'code');
  if (code === 'ERR_STRING_TOO_LONG') return true;
  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE') return true;
  const originalMessage = readArtifactFailureField(err, 'message');
  const message = typeof originalMessage === 'string' ? originalMessage : '';
  return message.includes('Invalid string length');
};

export const shouldAbortForHeap = (bytes) => {
  try {
    const stats = getHeapStatistics();
    const limit = Number(stats?.heap_size_limit);
    const used = Number(stats?.used_heap_size);
    if (!Number.isFinite(limit) || !Number.isFinite(used) || limit <= 0) return false;
    const remaining = limit - used;
    if (!Number.isFinite(remaining) || remaining <= 0) return false;
    return bytes * 3 > remaining;
  } catch {
    return false;
  }
};
