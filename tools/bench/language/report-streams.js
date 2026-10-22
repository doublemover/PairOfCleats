import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath, openContainedFile, verifyContainedFileHandle } from '../../../src/shared/contained-file.js';
import { readExactAt } from '../../../src/shared/io/read-exact.js';
import { throwIfAborted } from '../../../src/shared/abort.js';

const READ_BYTES = 64 * 1024;
export const REPORT_MAX_LINE_BYTES = 1024 * 1024;
const SUFFIXES = ['.diagnostics.jsonl', '.progress-confidence.jsonl', '.log'];
const stamp = (stat) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(stat[key]));
const sameStamp = (left, right) => left.every((value, index) => value === right[index]);

/** One invocation inventory. No links are followed and every length is captured before reduction. */
export const discoverReportStreams = async (resultsRoot, { runSuffix = null, signal = null } = {}) => {
  const root = resultsRoot ? path.resolve(resultsRoot, 'logs', 'bench-language') : null;
  const inventory = { root, entries: [], errors: [], directoryVisits: 0 };
  if (!root) return inventory;
  const suffix = String(runSuffix || '').trim();
  const prefix = suffix ? `${suffix.startsWith('run-') ? suffix : `run-${suffix}`}-` : null;
  const pending = [root];
  while (pending.length) {
    throwIfAborted(signal);
    const dir = pending.pop();
    let children;
    try {
      // Recheck directory components so an enumerated directory cannot be swapped for a link.
      assertNoSymlinkPath(root, dir);
      inventory.directoryVisits += 1;
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (dir !== root || error?.code !== 'ENOENT') inventory.errors.push({ path: dir, code: error?.code || 'ERR_REPORT_DIRECTORY' });
      continue;
    }
    for (const child of children) {
      throwIfAborted(signal);
      const filePath = path.join(dir, child.name);
      if (child.isDirectory()) { pending.push(filePath); continue; }
      if (!child.isFile() || !SUFFIXES.some(value => child.name.endsWith(value)) || (prefix && !child.name.startsWith(prefix))) continue;
      try {
        const stat = await fs.lstat(filePath, { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw Object.assign(new Error('Unsupported report file.'), { code: 'ERR_REPORT_FILE' });
        inventory.entries.push(Object.freeze({ path: filePath, bytes: Number(stat.size), stamp: Object.freeze(stamp(stat)),
          identity: Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) }) }));
      } catch (error) {
        inventory.errors.push({ path: filePath, code: error?.code || 'ERR_REPORT_FILE' });
      }
    }
  }
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
        const line = Buffer.concat(chunks, lineBytes).toString('utf8').trim();
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
    primary = error;
    if (consumerFailed || signal?.aborted || error?.name === 'AbortError') throw error;
    result.incomplete = true; result.reason = error?.code || 'ERR_REPORT_READ';
    return result;
  } finally {
    if (handle) {
      try { await handle.close(); } catch (error) {
        result.incomplete = true; result.reason ||= error?.code || 'ERR_REPORT_CLOSE';
        if (primary && typeof primary === 'object') primary.closeError = error;
      }
    }
  }
};

export const createReportStreamContext = (inventory, { signal = null } = {}) => {
  const metrics = { directoryVisits: inventory.directoryVisits, fileOpens: 0, bytesRead: 0 };
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
        errors: inventory.errors, files: reads, metrics: { ...metrics } };
    }
  };
};
