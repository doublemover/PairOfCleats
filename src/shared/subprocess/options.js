const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_KILL_GRACE_MS = 5000;
const TRACKED_SUBPROCESS_FORCE_GRACE_MS = 0;
const TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT = 8;
const TRACKED_SUBPROCESS_SNAPSHOT_MAX_LIMIT = 256;
const TRACKED_SUBPROCESS_ARGS_PREVIEW_MAX = 4;
const PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT = 12;
const PROCESS_SNAPSHOT_MAX_FRAME_LIMIT = 64;
const PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT = 8;
const PROCESS_SNAPSHOT_MAX_HANDLE_TYPE_LIMIT = 64;

const SHELL_MODE_DISABLED_ERROR = (
  'spawnSubprocess shell mode is disabled for security; pass an executable and args with shell=false.'
);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Resolve a conservative subprocess fanout preset for platform/filesystem.
 *
 * Callers can use this as a baseline and still apply explicit config
 * overrides. The preset intentionally prefers stability over maximal fanout on
 * higher startup-cost environments.
 *
 * @param {{platform?:string,cpuCount?:number,filesystemProfile?:'ntfs'|'posix'|'unknown'}} [input]
 * @returns {{maxParallelismHint:number,reason:string}}
 */
const resolveSubprocessFanoutPreset = (input = {}) => {
  const platform = typeof input.platform === 'string' ? input.platform : process.platform;
  const filesystemProfile = typeof input.filesystemProfile === 'string'
    ? input.filesystemProfile
    : 'unknown';
  const cpuCount = Number.isFinite(Number(input.cpuCount))
    ? Math.max(1, Math.floor(Number(input.cpuCount)))
    : 1;
  if (platform === 'win32' || filesystemProfile === 'ntfs') {
    return {
      maxParallelismHint: Math.max(1, Math.min(cpuCount, Math.ceil(cpuCount * 0.75))),
      reason: 'win32-ntfs-startup-cost'
    };
  }
  if (filesystemProfile === 'posix') {
    return {
      maxParallelismHint: Math.max(1, cpuCount),
      reason: 'posix-default'
    };
  }
  return {
    maxParallelismHint: Math.max(1, Math.min(cpuCount, Math.ceil(cpuCount * 0.85))),
    reason: 'generic-conservative'
  };
};

const resolveMaxOutputBytes = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_OUTPUT_BYTES;
  return Math.floor(parsed);
};

const resolveKillGraceMs = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_KILL_GRACE_MS;
  return Math.floor(parsed);
};

const resolveExpectedExitCodes = (value) => {
  if (Array.isArray(value) && value.length) {
    const normalized = value
      .map((entry) => Math.trunc(Number(entry)))
      .filter(Number.isFinite);
    return normalized.length ? normalized : [0];
  }
  return [0];
};

const resolveSnapshotLimit = (value, fallback = TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(TRACKED_SUBPROCESS_SNAPSHOT_MAX_LIMIT, Math.floor(parsed)));
};

const resolveFrameLimit = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT;
  return Math.max(1, Math.min(PROCESS_SNAPSHOT_MAX_FRAME_LIMIT, Math.floor(parsed)));
};

const resolveHandleTypeLimit = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT;
  return Math.max(1, Math.min(PROCESS_SNAPSHOT_MAX_HANDLE_TYPE_LIMIT, Math.floor(parsed)));
};

const toIsoTimestamp = (value) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed).toISOString();
};

const toSafeArgList = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
};

const toSafeArgsPreview = (args) => (
  Array.isArray(args)
    ? args.slice(0, TRACKED_SUBPROCESS_ARGS_PREVIEW_MAX).map((entry) => String(entry))
    : []
);

const coerceOutputMode = (value) => (value === 'lines' ? 'lines' : 'string');

const coerceStdio = (value) => value ?? 'pipe';

const shouldCapture = (stdio, captureFlag, streamIndex) => {
  if (captureFlag === false) return false;
  if (captureFlag === true) return true;
  if (stdio === 'pipe') return true;
  if (Array.isArray(stdio)) return stdio[streamIndex] === 'pipe';
  return false;
};

const createCollector = ({ enabled, maxOutputBytes, encoding }) => {
  const chunks = [];
  let totalBytes = 0;
  const push = (chunk) => {
    if (!enabled) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    if (!buffer.length) return;
    chunks.push(buffer);
    totalBytes += buffer.length;
    while (totalBytes > maxOutputBytes && chunks.length) {
      const overflow = totalBytes - maxOutputBytes;
      const head = chunks[0];
      if (head.length <= overflow) {
        chunks.shift();
        totalBytes -= head.length;
      } else {
        chunks[0] = head.subarray(overflow);
        totalBytes -= overflow;
      }
    }
  };
  const toOutput = (mode) => {
    if (!enabled) return undefined;
    if (!chunks.length) return mode === 'lines' ? [] : '';
    const text = Buffer.concat(chunks).toString(encoding);
    if (mode !== 'lines') return text;
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  return { push, toOutput };
};

const buildResult = ({ pid, exitCode, signal, startedAt, stdout, stderr }) => ({
  pid,
  exitCode,
  signal,
  durationMs: Math.max(0, Date.now() - startedAt),
  stdout,
  stderr
});

const trimOutput = (value, maxBytes, encoding, mode) => {
  if (value == null) return mode === 'lines' ? [] : '';
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), encoding);
  if (buffer.length <= maxBytes) {
    const text = buffer.toString(encoding);
    if (mode !== 'lines') return text;
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }
  const tail = buffer.subarray(buffer.length - maxBytes);
  const text = tail.toString(encoding);
  if (mode !== 'lines') return text;
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

export {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_KILL_GRACE_MS,
  TRACKED_SUBPROCESS_FORCE_GRACE_MS,
  TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT,
  TRACKED_SUBPROCESS_SNAPSHOT_MAX_LIMIT,
  TRACKED_SUBPROCESS_ARGS_PREVIEW_MAX,
  PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT,
  PROCESS_SNAPSHOT_MAX_FRAME_LIMIT,
  PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT,
  PROCESS_SNAPSHOT_MAX_HANDLE_TYPE_LIMIT,
  SHELL_MODE_DISABLED_ERROR,
  toNumber,
  resolveSubprocessFanoutPreset,
  resolveMaxOutputBytes,
  resolveKillGraceMs,
  resolveExpectedExitCodes,
  resolveSnapshotLimit,
  resolveFrameLimit,
  resolveHandleTypeLimit,
  toIsoTimestamp,
  toSafeArgList,
  toSafeArgsPreview,
  coerceOutputMode,
  coerceStdio,
  shouldCapture,
  createCollector,
  buildResult,
  trimOutput
};
