import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJsonlBatchWriter } from '../../../shared/json-stream/jsonl-batch.js';
import { mergeSortedRunsToFile, readJsonlRows } from '../../../shared/merge.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { isPathWithinRoot, isRelativePathEscape, toPosix } from '../../../shared/file-paths.js';

const ROWS_PER_RUN = 256;
const BYTES_PER_RUN = 256 * 1024;
const MERGE_FAN_IN = 8;
const MAX_SCRATCH_BYTES = 256 * 1024 * 1024;
const MAX_RUN_LEVELS = 32;
const compareNames = (left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
const directoryChanged = () => Object.assign(new Error('Discovery directory changed during enumeration.'), { code: 'ERR_DISCOVERY_DIRECTORY_CHANGED' });
const directoryStamp = stat => ['dev', 'ino', 'mtimeNs', 'ctimeNs'].map(key => String(stat[key]));

/** Private scratch only. All destructive cleanup targets are checked against this exact allocated root. */
const createCandidateScratch = async (metrics) => {
  const parent = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'pairofcleats-discovery-'));
  if (path.dirname(path.resolve(root)) !== parent || !path.basename(root).startsWith('pairofcleats-discovery-')) throw new Error('Invalid discovery scratch root.');
  let serial = 0;
  let liveBytes = 0;
  const sizes = new Map();
  const checked = target => {
    const resolved = path.resolve(target);
    if (resolved === root || !isPathWithinRoot(resolved, root)) throw new Error('Discovery scratch target is outside its owner.');
    return resolved;
  };
  return {
    root,
    next() { serial += 1; return path.join(root, `run-${serial}.jsonl`); },
    reserve(target, bytes) {
      checked(target);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || liveBytes + bytes > MAX_SCRATCH_BYTES) {
        throw Object.assign(new Error('Discovery candidate scratch byte budget exceeded.'), { code: 'ERR_DISCOVERY_SCRATCH_BUDGET' });
      }
      sizes.set(target, (sizes.get(target) || 0) + bytes); liveBytes += bytes;
      metrics.scratchBytesHighWater = Math.max(metrics.scratchBytesHighWater || 0, liveBytes);
    },
    size(target) { return sizes.get(target) || 0; },
    async remove(target) {
      await fs.rm(checked(target), { force: true });
      liveBytes -= sizes.get(target) || 0; sizes.delete(target);
    },
    async close() {
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('pairofcleats-discovery-')) throw new Error('Invalid discovery scratch cleanup target.');
      await fs.rm(resolved, { recursive: true, force: true });
    }
  };
};

const sortCandidateRows = async function* (source, { scratch, signal, metrics }) {
  const levels = [];
  let buffer = [];
  let bytes = 0;
  const merge = async (runs) => {
    throwIfAborted(signal);
    const output = scratch.next();
    const outputBytes = runs.reduce((sum, run) => sum + scratch.size(run), 0);
    scratch.reserve(output, outputBytes);
    const guardedRead = async function* (file) {
      for await (const row of readJsonlRows(file)) { throwIfAborted(signal); yield row; }
    };
    await mergeSortedRunsToFile({ runs, outputPath: output, compare: compareNames, readRun: guardedRead,
      maxBufferRows: ROWS_PER_RUN, maxBufferBytes: BYTES_PER_RUN });
    metrics.spillBytesWritten = (metrics.spillBytesWritten || 0) + outputBytes;
    for (const run of runs) await scratch.remove(run);
    return output;
  };
  const admitRun = async (run, level = 0) => {
    if (level >= MAX_RUN_LEVELS) throw new Error('Discovery merge level budget exceeded.');
    const pending = levels[level] ||= [];
    pending.push(run);
    if (pending.length === MERGE_FAN_IN) {
      const combined = await merge(pending.splice(0));
      await admitRun(combined, level + 1);
    }
  };
  const spill = async () => {
    if (!buffer.length) return;
    buffer.sort(compareNames);
    const payload = buffer.map(row => JSON.stringify(row)).join('\n') + '\n';
    const run = scratch.next();
    const length = Buffer.byteLength(payload);
    scratch.reserve(run, length);
    await fs.writeFile(run, payload);
    metrics.spillBytesWritten = (metrics.spillBytesWritten || 0) + length;
    await admitRun(run);
    buffer = []; bytes = 0;
  };
  for await (const row of source) {
    throwIfAborted(signal);
    const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (rowBytes > BYTES_PER_RUN) throw Object.assign(new Error('Discovery candidate label exceeds its byte envelope.'), { code: 'ERR_DISCOVERY_PATH_TOO_LARGE' });
    if (buffer.length && (buffer.length >= ROWS_PER_RUN || bytes + rowBytes > BYTES_PER_RUN)) await spill();
    buffer.push(row); bytes += rowBytes;
    metrics.sortRowsHighWater = Math.max(metrics.sortRowsHighWater || 0, buffer.length);
    metrics.sortBytesHighWater = Math.max(metrics.sortBytesHighWater || 0, bytes);
  }
  if (!levels.some(level => level.length)) {
    buffer.sort(compareNames); yield* buffer; return;
  }
  await spill();
  let runs = levels.flat();
  // At most fan-in * level-count paths survive incremental compaction.
  while (runs.length > 1) {
    const next = [];
    for (let index = 0; index < runs.length; index += MERGE_FAN_IN) {
      const group = runs.slice(index, index + MERGE_FAN_IN);
      next.push(group.length === 1 ? group[0] : await merge(group));
    }
    runs = next;
  }
  const final = runs[0];
  try { for await (const row of readJsonlRows(final)) { throwIfAborted(signal); yield row; } }
  finally { await scratch.remove(final); }
};

const readDirectoryRows = async function* (canonicalRoot, dir, { signal, strictTraversal, onError, metrics }) {
  throwIfAborted(signal);
  let handle = null;
  let primary = null;
  try {
    const before = await fs.lstat(dir, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory()) throw directoryChanged();
    const canonical = await fs.realpath(dir);
    if (!isPathWithinRoot(canonical, canonicalRoot)) throw directoryChanged();
    handle = await fs.opendir(dir, { bufferSize: 32 });
    metrics.directoriesEnumerated = (metrics.directoriesEnumerated || 0) + 1;
    for await (const entry of handle) {
      throwIfAborted(signal);
      metrics.directoryEntries = (metrics.directoryEntries || 0) + 1;
      yield { name: entry.name, kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' };
    }
    handle = null; // async directory iteration has completed its close.
    const after = await fs.lstat(dir, { bigint: true });
    if (after.isSymbolicLink() || directoryStamp(before).some((value, index) => value !== directoryStamp(after)[index])) throw directoryChanged();
  } catch (error) {
    primary = error;
    throwIfAborted(signal);
    metrics.directoryErrors = (metrics.directoryErrors || 0) + 1;
    onError?.(dir, error);
    if (strictTraversal) throw error;
  } finally {
    if (handle) {
      try { await handle.close(); } catch (error) {
        if (error?.code !== 'ERR_DIR_CLOSED') {
          if (primary && typeof primary === 'object') primary.closeError = error;
          else throw error;
        }
      }
    }
  }
};

/** Deterministic breadth-first parent order and UTF-16 lexical child order. No whole-tree path list. */
export const iterateFilesystemCandidates = async function* ({ root, canonicalRoot, ignoreMatcher, maxDepth = null,
  strictTraversal = false, signal = null, onError = null, metrics = {} }) {
  const scratch = await createCandidateScratch(metrics);
  let primary = null;
  try {
    let frontier = [{ dir: path.resolve(root), depth: 0 }];
    let frontierFile = null;
    while (frontier || frontierFile) {
      let nextFile = null;
      let writer = null;
      let phaseError = null;
      const parents = frontier || readJsonlRows(frontierFile);
      try {
        for await (const current of parents) {
          throwIfAborted(signal);
          const source = readDirectoryRows(canonicalRoot, current.dir, { signal, strictTraversal, onError, metrics });
          for await (const entry of sortCandidateRows(source, { scratch, signal, metrics })) {
            const fullPath = path.join(current.dir, entry.name);
            if (entry.kind === 'directory') {
              if (maxDepth !== null && current.depth >= maxDepth) continue;
              const rel = toPosix(path.relative(root, fullPath));
              if (isRelativePathEscape(rel) || path.isAbsolute(rel)) continue;
              if (ignoreMatcher?.ignores(rel) && !ignoreMatcher.shouldTraverseIgnoredDirectory?.(rel)) continue;
              if (!writer) { nextFile = scratch.next(); writer = createJsonlBatchWriter(nextFile, { atomic: false }); }
              const line = JSON.stringify({ dir: fullPath, depth: current.depth + 1 });
              scratch.reserve(nextFile, Buffer.byteLength(line) + 1);
              await writer.writeLine(line, Buffer.byteLength(line) + 1);
            } else if (entry.kind === 'file' || entry.kind === 'link') yield fullPath;
          }
        }
        if (writer) { await writer.close(); writer = null; }
      } catch (error) { phaseError = error; throw error; }
      finally {
        if (writer) {
          try { await writer.destroy(phaseError); } catch (error) {
            if (phaseError && typeof phaseError === 'object') phaseError.writerCleanupError = error;
            else throw error;
          }
        }
      }
      if (frontierFile) await scratch.remove(frontierFile);
      frontier = null; frontierFile = nextFile;
    }
  } catch (error) { primary = error; throw error; }
  finally {
    try { await scratch.close(); } catch (error) {
      if (primary && typeof primary === 'object') primary.cleanupError = error;
      else throw error;
    }
  }
};

/** Legacy provider arrays are borrowed in place; adapters retain their existing 64 MiB output guard. */
export const iterateScmCandidates = async function* ({ files, repoRoot, ordered = false, signal = null, metrics = {} }) {
  const scratch = ordered ? null : await createCandidateScratch(metrics);
  let primary = null;
  const source = async function* () {
    for await (const rel of files) {
      throwIfAborted(signal);
      if (typeof rel !== 'string' || !rel) continue;
      const target = path.resolve(repoRoot, rel);
      if (!isPathWithinRoot(target, repoRoot)) continue;
      yield { name: target };
    }
  };
  try {
    let previous = null;
    const rows = ordered ? source() : sortCandidateRows(source(), { scratch, signal, metrics });
    for await (const row of rows) {
      if (ordered && previous !== null && row.name < previous) throw Object.assign(new Error('SCM candidate stream violates its declared order.'), { code: 'ERR_SCM_FILE_ORDER' });
      if (row.name === previous) continue;
      previous = row.name; yield row.name;
    }
  } catch (error) { primary = error; throw error; }
  finally {
    try { await scratch?.close(); } catch (error) {
      if (primary && typeof primary === 'object') primary.cleanupError = error;
      else throw error;
    }
  }
};
