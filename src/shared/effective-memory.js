import os from 'node:os';

const nonnegative = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : null;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : null;

/** One budget/pressure source for host, container and configured memory boundaries. */
export const readEffectiveMemory = (input = {}) => {
  const hostTotalBytes = positive(input.hostTotalBytes ?? os.totalmem());
  const hostFreeBytes = nonnegative(input.hostFreeBytes ?? os.freemem());
  const constrainedBytes = positive(input.constrainedBytes ?? process.constrainedMemory?.());
  const configuredLimitBytes = positive(input.configuredLimitBytes);
  const availableBytes = nonnegative(input.availableBytes ?? process.availableMemory?.());
  const rssBytes = Math.max(0, Number(input.rssBytes ?? process.memoryUsage().rss) || 0);
  const bounds = [hostTotalBytes, constrainedBytes, configuredLimitBytes].filter(value => value != null);
  const totalBytes = bounds.length ? Math.min(...bounds) : null;
  // Process availability includes reclaimable pages on macOS and process
  // constraints elsewhere. Raw host free pages are only a fallback; taking
  // their minimum would discard that headroom. A reported zero stays pressure.
  const headrooms = [availableBytes ?? hostFreeBytes, totalBytes == null ? null : Math.max(0, totalBytes - rssBytes)]
    .filter(value => value != null);
  const freeBytes = headrooms.length ? Math.max(0, Math.min(...headrooms)) : 0;
  return { totalBytes, freeBytes, rssBytes, hostTotalBytes, hostFreeBytes, constrainedBytes,
    configuredLimitBytes, availableBytes, constrained: totalBytes != null && totalBytes < hostTotalBytes,
    method: 'minimum-host-container-configured-budget-and-available-headroom' };
};

/** Retained strings/maps use conservative estimates; native RSS remains measured separately. */
export const estimateRetainedBytes = (value, seen = new Set()) => {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2 + 32;
  if (typeof value === 'number' || typeof value === 'bigint') return 8;
  if (typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return 64 + estimateRetainedBytes(value.buffer, seen);
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return value.byteLength + 32;
  if (Array.isArray(value)) return 32 + value.reduce((bytes, entry) => bytes + 8 + estimateRetainedBytes(entry, seen), 0);
  if (value instanceof Map) return 64 + [...value].reduce((bytes, [key, entry]) => bytes + 48
    + estimateRetainedBytes(key, seen) + estimateRetainedBytes(entry, seen), 0);
  if (value instanceof Set) return 64 + [...value].reduce((bytes, entry) => bytes + 32 + estimateRetainedBytes(entry, seen), 0);
  return 64 + Object.entries(value).reduce((bytes, [key, entry]) => bytes + 16
    + estimateRetainedBytes(key, seen) + estimateRetainedBytes(entry, seen), 0);
};
