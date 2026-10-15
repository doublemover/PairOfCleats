const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_KILL_GRACE_MS = 5000;
const TRACKED_SUBPROCESS_FORCE_GRACE_MS = 0;
const TRACKED_SUBPROCESS_SNAPSHOT_DEFAULT_LIMIT = 8;
const TRACKED_SUBPROCESS_SNAPSHOT_MAX_LIMIT = 256;
const TRACKED_SUBPROCESS_EVENT_DEFAULT_LIMIT = 64;
const TRACKED_SUBPROCESS_EVENT_MAX_LIMIT = 4096;
const TRACKED_SUBPROCESS_ARGS_PREVIEW_MAX = 4;
const PROCESS_SNAPSHOT_DEFAULT_FRAME_LIMIT = 12;
const PROCESS_SNAPSHOT_MAX_FRAME_LIMIT = 64;
const PROCESS_SNAPSHOT_DEFAULT_HANDLE_TYPE_LIMIT = 8;
const PROCESS_SNAPSHOT_MAX_HANDLE_TYPE_LIMIT = 64;
const WIN32_NTFS_MAX_PARALLELISM_HINT = 16;

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
      maxParallelismHint: Math.max(1, Math.min(cpuCount, WIN32_NTFS_MAX_PARALLELISM_HINT)),
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

const resolveEventLimit = (value, fallback = TRACKED_SUBPROCESS_EVENT_DEFAULT_LIMIT) => {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(TRACKED_SUBPROCESS_EVENT_MAX_LIMIT, Math.floor(parsed)));
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
  let headIndex = 0;
  let totalBytes = 0;
  let observedBytes = 0;
  let outputBytes = 0;
  let encodingLoss = false;

  const maybeCompact = () => {
    // Avoid repeated O(n) shifts under sustained output pressure by compacting
    // in batches once enough head entries were consumed.
    if (headIndex < 64 || headIndex * 2 < chunks.length) return;
    chunks.splice(0, headIndex);
    headIndex = 0;
  };

  const push = (chunk) => {
    const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, encoding);
    observedBytes += size;
    if (!enabled) return;
    if (!size) return;
    const retainedSize = Math.min(size, maxOutputBytes);
    // Evict before copying a new tail. Dropped slots must release their buffers,
    // and partial tails must not keep the oversized original backing allocation.
    while (totalBytes + retainedSize > maxOutputBytes && headIndex < chunks.length) {
      const overflow = totalBytes + retainedSize - maxOutputBytes;
      const head = chunks[headIndex];
      if (head.length <= overflow) {
        chunks[headIndex] = null;
        headIndex += 1;
        totalBytes -= head.length;
      } else {
        const tail = Buffer.allocUnsafeSlow(head.length - overflow);
        head.copy(tail, 0, overflow);
        chunks[headIndex] = tail;
        totalBytes -= overflow;
      }
    }
    maybeCompact();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    const owned = Buffer.allocUnsafeSlow(retainedSize);
    buffer.copy(owned, 0, buffer.length - retainedSize);
    chunks.push(owned);
    totalBytes += retainedSize;
  };
  const toOutput = (mode) => {
    if (!enabled) return undefined;
    const activeChunks = headIndex > 0 ? chunks.slice(headIndex) : chunks;
    if (!activeChunks.length) return mode === 'lines' ? [] : '';
    const bytes = Buffer.concat(activeChunks);
    let text = bytes.toString(encoding);
    const encoded = Buffer.from(text, encoding);
    encodingLoss = !encoded.equals(bytes);
    if (encoded.length > maxOutputBytes) {
      let start = encoded.length - maxOutputBytes;
      if (encoding === 'utf8' || encoding === 'utf-8') {
        while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start += 1;
      }
      text = encoded.subarray(start).toString(encoding);
    }
    outputBytes = Buffer.byteLength(text, encoding);
    if (mode !== 'lines') return text;
    const lines = text.split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  return { push, toOutput, stats: () => ({ enabled, maxBytes: maxOutputBytes,
    observedBytes, retainedBytes: totalBytes, droppedBytes: observedBytes - totalBytes,
    retainedBufferBytes: chunks.reduce((sum, chunk) => sum + (chunk?.buffer.byteLength || 0), 0),
    outputBytes, encodingLoss, truncated: enabled && observedBytes > totalBytes }) };
};

const buildResult = ({ pid, exitCode, signal, startedAt, stdout, stderr, outputCapture }) => ({
  pid,
  exitCode,
  signal,
  durationMs: Math.max(0, Date.now() - startedAt),
  stdout,
  stderr,
  ...(outputCapture ? { outputCapture } : {})
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
  TRACKED_SUBPROCESS_EVENT_DEFAULT_LIMIT,
  TRACKED_SUBPROCESS_EVENT_MAX_LIMIT,
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
  resolveEventLimit,
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
