/**
 * Lightweight telemetry hook for large artifact reads.
 *
 * Consumers can register an observer to capture read duration, size, and format
 * without coupling the shared IO layer to a specific metrics backend.
 */

const DEFAULT_ARTIFACT_READ_THRESHOLD = 8 * 1024 * 1024;
let observer = null;
let thresholdBytes = DEFAULT_ARTIFACT_READ_THRESHOLD;

const normalizeThreshold = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return DEFAULT_ARTIFACT_READ_THRESHOLD;
  return Math.floor(size);
};

/**
 * Register an observer for large artifact reads.
 * @param {(entry: {path:string,format:string,compression:string|null,bytes:number,rawBytes:number,durationMs:number}) => void} next
 * @param {{thresholdBytes?:number}} [options]
 */
export const setArtifactReadObserver = (next, options = {}) => {
  observer = typeof next === 'function' ? next : null;
  thresholdBytes = normalizeThreshold(options.thresholdBytes);
};

export const hasArtifactReadObserver = () => typeof observer === 'function';

export const recordArtifactRead = (entry) => {
  if (!observer) return;
  const bytes = Number(entry?.bytes ?? entry?.rawBytes ?? 0);
  if (!Number.isFinite(bytes) || bytes < thresholdBytes) return;
  observer({
    ...entry,
    bytes,
    rawBytes: Number(entry?.rawBytes ?? bytes) || bytes
  });
};

export { DEFAULT_ARTIFACT_READ_THRESHOLD };
