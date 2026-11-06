import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath, openContainedFile, verifyContainedFileHandle } from '../../../src/shared/contained-file.js';
import { readExactAt } from '../../../src/shared/io/read-exact.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { withStorageDirectory } from '../../../src/shared/storage/directory.js';
import { describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';

const READ_BYTES = 64 * 1024;
const REPORT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
export const REPORT_MAX_LINE_BYTES = 1024 * 1024;
const SUFFIXES = ['.diagnostics.jsonl', '.progress-confidence.jsonl', '.log'];
const stamp = (stat) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(stat[key]));
const sameStamp = (left, right) => left.every((value, index) => value === right[index]);
export const REPORT_STREAM_INVENTORY_LIMITS = Object.freeze({ entries: 65536, directories: 4096, depth: 64,
  pathBytes: 8 * 1024 * 1024, capturedBytes: 1024 * 1024 * 1024, workMs: 5000 });

/** One invocation inventory. No links are followed and every length is captured before reduction. */
export const discoverReportStreams = async (resultsRoot, { runSuffix = null, signal = null, limits = REPORT_STREAM_INVENTORY_LIMITS } = {}) => {
  const bounds = { ...REPORT_STREAM_INVENTORY_LIMITS, ...limits };
  for (const [name, value] of Object.entries(bounds)) {
    if (!Object.hasOwn(REPORT_STREAM_INVENTORY_LIMITS, name) || !Number.isSafeInteger(value)
      || value < 1 || value > REPORT_STREAM_INVENTORY_LIMITS[name]) throw new RangeError('Invalid report inventory bound: ' + name);
  }
  const root = resultsRoot ? path.resolve(resultsRoot, 'logs', 'bench-language') : null;
  const inventory = { root, entries: [], errors: [], errorCount: 0, errorsOmitted: 0, directoryVisits: 0,
    entriesVisited: 0, directoriesDiscovered: root ? 1 : 0, retainedPathBytes: root ? Buffer.byteLength(root) : 0,
    capturedBytes: 0, limits: bounds, stopped: false };
  if (!root) return inventory;
  const record = error => {
    inventory.errorCount++;
    if (inventory.errors.length < 128) inventory.errors.push(error); else inventory.errorsOmitted++;
  };
  const stop = (reason, target) => {
    if (!inventory.stopped) record({ path: target, code: 'ERR_REPORT_INVENTORY_LIMIT', reason });
    inventory.stopped = true;
  };
  const began = performance.now();
  const check = target => {
    throwIfAborted(signal);
    if (performance.now() - began >= bounds.workMs) stop('workMs', target);
    return !inventory.stopped;
  };
  if (inventory.retainedPathBytes > bounds.pathBytes) stop('pathBytes', root);
  const suffix = String(runSuffix || '').trim();
  const prefix = suffix ? `${suffix.startsWith('run-') ? suffix : `run-${suffix}`}-` : null;
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length && check(root)) {
    const { directory: dir, depth } = pending.pop();
    try {
      // Recheck directory components so an enumerated directory cannot be swapped for a link.
      assertNoSymlinkPath(root, dir);
      inventory.directoryVisits += 1;
      await withStorageDirectory(dir, async reader => {
        assertNoSymlinkPath(root, dir);
        while (check(dir)) {
          if (inventory.entriesVisited >= bounds.entries) { stop('entries', dir); break; }
          const child = await reader.read();
          if (!check(dir)) break;
          if (!child) break;
          inventory.entriesVisited++;
          const filePath = path.join(dir, child.name);
          if (child.isDirectory()) {
            if (depth + 1 > bounds.depth) { stop('depth', filePath); break; }
            if (inventory.directoriesDiscovered >= bounds.directories) { stop('directories', filePath); break; }
            if (inventory.retainedPathBytes + Buffer.byteLength(filePath) > bounds.pathBytes) { stop('pathBytes', filePath); break; }
            inventory.directoriesDiscovered++; inventory.retainedPathBytes += Buffer.byteLength(filePath);
            pending.push({ directory: filePath, depth: depth + 1 }); continue;
          }
          if (!child.isFile() || !SUFFIXES.some(value => child.name.endsWith(value)) || (prefix && !child.name.startsWith(prefix))) continue;
          if (inventory.retainedPathBytes + Buffer.byteLength(filePath) > bounds.pathBytes) { stop('pathBytes', filePath); break; }
          try {
            const stat = await fs.lstat(filePath, { bigint: true });
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw Object.assign(new Error('Unsupported report file.'), { code: 'ERR_REPORT_FILE' });
            if (stat.size > BigInt(bounds.capturedBytes - inventory.capturedBytes)) { stop('capturedBytes', filePath); break; }
            inventory.retainedPathBytes += Buffer.byteLength(filePath); inventory.capturedBytes += Number(stat.size);
            inventory.entries.push(Object.freeze({ path: filePath, bytes: Number(stat.size), stamp: Object.freeze(stamp(stat)),
              identity: Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) }) }));
          } catch (error) {
            const { code } = describeStorageFailure(error, { phase: 'bench-report-file-inventory', defaultCode: 'ERR_REPORT_FILE' });
            record({ path: filePath, code });
          }
        }
      });
    } catch (error) {
      // An unconfirmed original directory close is a resource failure, never an
      // ordinary inventory warning that permits reduction to continue.
      const { code } = describeStorageFailure(error, { phase: 'bench-report-directory-inventory', defaultCode: 'ERR_REPORT_DIRECTORY' });
      throwIfAborted(signal);
      if (dir !== root || code !== 'ENOENT') record({ path: dir, code });
    }
  }
  check(root);
  inventory.entries.sort((left, right) => left.path.localeCompare(right.path));
  return inventory;
};

/** Bounded per-line transport. Reducers keep their own event definitions and state. */
export const readReportStream = async (inventory, entry, onLine, {
  signal = null, metrics = null, maxLineBytes = REPORT_MAX_LINE_BYTES
} = {}) => {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1 || maxLineBytes > REPORT_MAX_LINE_BYTES) throw new RangeError('Invalid report line bound.');
  const result = { path: entry.path, capturedBytes: entry.bytes, bytesRead: 0, oversizedLines: 0,
    unterminatedFinalLine: false, incomplete: false, reason: null };
  let handle = null;
  let primary = null;
  let primaryPresent = false;
  let consumerFailed = false;
  try {
    throwIfAborted(signal);
    handle = await openContainedFile(inventory.root, entry.path, { expectedFileIdentity: entry.identity });
    if (metrics) metrics.fileOpens = (metrics.fileOpens || 0) + 1;
    if (!sameStamp(entry.stamp, stamp(await handle.stat({ bigint: true })))) {
      result.incomplete = true; result.reason = 'changed-before-read'; return result;
    }
    const buffer = Buffer.alloc(Math.min(READ_BYTES, Math.max(1, entry.bytes)));
    let chunks = [];
    let lineBytes = 0;
    let oversized = false;
    const append = (span) => {
      lineBytes += span.length;
      if (lineBytes > maxLineBytes) { oversized = true; chunks = []; }
      else if (!oversized && span.length) chunks.push(Buffer.from(span));
    };
    const emit = () => {
      if (oversized) {
        result.oversizedLines += 1; result.incomplete = true; result.reason ||= 'line-too-large';
      } else if (lineBytes) {
        const line = REPORT_UTF8_DECODER.decode(Buffer.concat(chunks, lineBytes)).trim();
        if (line) {
          try {
            const completion = onLine(line);
            if (completion && typeof completion.then === 'function') return Promise.resolve(completion).catch(error => { consumerFailed = true; throw error; });
            return completion;
          } catch (error) { consumerFailed = true; throw error; }
        }
      }
      return null;
    };
    let position = 0;
    while (position < entry.bytes) {
      throwIfAborted(signal);
      const length = Math.min(buffer.length, entry.bytes - position);
      const { bytesRead } = await readExactAt(handle, buffer, 0, length, position, { signal });
      result.bytesRead += bytesRead;
      if (metrics) metrics.bytesRead = (metrics.bytesRead || 0) + bytesRead;
      if (bytesRead !== length) { result.incomplete = true; result.reason = 'truncated-during-read'; break; }
      position += bytesRead;
      let start = 0;
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] !== 10) continue;
        append(buffer.subarray(start, index));
        const completion = emit();
        if (completion && typeof completion.then === 'function') await completion;
        chunks = []; lineBytes = 0; oversized = false; start = index + 1;
      }
      append(buffer.subarray(start, bytesRead));
    }
    if (lineBytes && result.reason !== 'truncated-during-read') {
      result.unterminatedFinalLine = true;
      const completion = emit();
      if (completion && typeof completion.then === 'function') await completion;
    }
    throwIfAborted(signal);
    verifyContainedFileHandle(handle, inventory.root, entry.path);
    if (!sameStamp(entry.stamp, stamp(await handle.stat({ bigint: true })))) {
      result.incomplete = true; result.reason = 'changed-during-read';
    }
    return result;
  } catch (error) {
    primary = error; primaryPresent = true;
    if (consumerFailed || signal?.aborted || error?.name === 'AbortError') throw error;
    result.incomplete = true; result.reason = error?.code || 'ERR_REPORT_READ';
    return result;
  } finally {
    if (handle) {
      try { await handle.close(); } catch (error) {
        result.incomplete = true; result.reason ||= 'original-close-failed';
        // A failed original close is not an ignorable parse observation. Keep
        // the real resource failure, including a falsey original consumer error.
        throw primaryPresent ? addStorageFailureContext(primary, { reportStreamPath: entry.path }, error,
          { secondaryPresent: true }) : error;
      }
    }
  }
};

export const createReportStreamContext = (inventory, { signal = null } = {}) => {
  const metrics = { directoryVisits: inventory.directoryVisits, entriesVisited: inventory.entriesVisited,
    retainedPathBytes: inventory.retainedPathBytes, capturedBytes: inventory.capturedBytes, fileOpens: 0, bytesRead: 0 };
  const reads = [];
  const entries = new Map(inventory.entries.map(entry => [entry.path, entry]));
  return {
    files(suffix) { return inventory.entries.filter(entry => entry.path.endsWith(suffix)).map(entry => entry.path); },
    async consume(filePath, onLine) {
      const entry = entries.get(filePath);
      if (!entry) throw new Error('Report file is outside this invocation inventory.');
      const result = await readReportStream(inventory, entry, onLine, { signal, metrics });
      reads.push(result);
      return result;
    },
    summary() {
      return { schemaVersion: 1, boundary: 'captured-file-length', maxLineBytes: REPORT_MAX_LINE_BYTES,
        incomplete: inventory.errors.length > 0 || reads.some(entry => entry.incomplete),
        inventoryLimits: inventory.limits, errorCount: inventory.errorCount, errorsOmitted: inventory.errorsOmitted,
        errors: inventory.errors, files: reads, metrics: { ...metrics } };
    }
  };
};
