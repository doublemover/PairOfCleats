import { getHeapStatistics } from 'node:v8';

export const toJsonTooLargeError = (filePath, size) => {
  const err = new Error(
    `JSON artifact too large to load (${size} bytes): ${filePath}`
  );
  err.code = 'ERR_JSON_TOO_LARGE';
  return err;
};

export const shouldTreatAsTooLarge = (err) => {
  if (!err) return false;
  if (err.code === 'ERR_STRING_TOO_LONG') return true;
  if (err.code === 'ERR_BUFFER_TOO_LARGE' || err.code === 'ERR_OUT_OF_RANGE') return true;
  const message = typeof err.message === 'string' ? err.message : '';
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
