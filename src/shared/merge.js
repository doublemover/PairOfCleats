import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { createJsonlBatchWriter } from './json-stream/jsonl-batch.js';
import { createTempPath, replaceFile } from './json-stream/atomic.js';
import { writeJsonObjectFile } from './json-stream.js';
import { compareStrings } from './sort.js';

export const MERGE_RUN_FORMAT = 'jsonl';
export const MERGE_RUN_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_OPEN_RUNS = 64;
export const DEFAULT_MAX_BUFFER_ROWS = 5000;
export const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export class MinHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value) {
    this.items.push(value);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (!this.items.length) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  bubbleUp(index) {
    const { items, compare } = this;
    let i = index;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (compare(items[i], items[parent]) >= 0) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  bubbleDown(index) {
    const { items, compare } = this;
    let i = index;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < items.length && compare(items[left], items[smallest]) < 0) {
        smallest = left;
      }
      if (right < items.length && compare(items[right], items[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === i) break;
      [items[i], items[smallest]] = [items[smallest], items[i]];
      i = smallest;
    }
  }
}

export const readJsonlRows = async function* (filePath, { parse = JSON.parse } = {}) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let buffer = '';
  let lineNumber = 0;
  try {
    for await (const chunk of stream) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        lineNumber += 1;
        const trimmed = line.trim();
        if (!trimmed) {
          newlineIndex = buffer.indexOf('\n');
          continue;
        }
        try {
          yield parse(trimmed);
        } catch (err) {
          const message = err?.message || 'JSON parse error';
          throw new Error(`Invalid JSONL at ${filePath}:${lineNumber}: ${message}`);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const trimmed = buffer.trim();
    if (trimmed) {
      lineNumber += 1;
      try {
        yield parse(trimmed);
      } catch (err) {
        const message = err?.message || 'JSON parse error';
        throw new Error(`Invalid JSONL at ${filePath}:${lineNumber}: ${message}`);
      }
    }
  } finally {
    if (!stream.destroyed) stream.destroy();
  }
};

const resolveRunPath = (run) => {
  if (!run) return null;
  if (typeof run === 'string') return run;
  if (typeof run === 'object' && typeof run.path === 'string') return run.path;
  return null;
};

const createComparator = (compare, { validateComparator = false } = {}) => {
  const base = typeof compare === 'function' ? compare : compareStrings;
  if (!validateComparator) return base;
  return (left, right) => {
    const result = base(left, right);
    const reverse = base(right, left);
    if (result === 0 && reverse !== 0) {
      throw new Error('Comparator is not antisymmetric (0 vs non-zero)');
    }
    if (result !== 0 && reverse !== 0 && Math.sign(result) !== -Math.sign(reverse)) {
      throw new Error('Comparator is not antisymmetric');
    }
    return result;
  };
};

export const createMergeRunManifest = ({
  runPath,
  rows,
  bytes,
  compareId = null,
  format = MERGE_RUN_FORMAT,
  sources = null,
  createdAt = null
} = {}) => ({
  version: MERGE_RUN_SCHEMA_VERSION,
  format,
  compareId,
  rows: Number.isFinite(rows) ? rows : null,
  bytes: Number.isFinite(bytes) ? bytes : null,
  path: runPath ? path.basename(runPath) : null,
  sources: Array.isArray(sources) ? sources : null,
  createdAt: createdAt || new Date().toISOString()
});

export const writeMergeRunManifest = async (manifestPath, manifest) => {
  if (!manifestPath) return;
  await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });
};

export const writeJsonlRunFile = async (
  filePath,
  rows,
  {
    atomic = true,
    serialize = null,
    maxBufferRows = DEFAULT_MAX_BUFFER_ROWS,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES
  } = {}
) => {
  const writer = createJsonlBatchWriter(filePath, { atomic });
  const stringify = typeof serialize === 'function' ? serialize : (value) => JSON.stringify(value);
  let buffer = [];
  let bufferBytes = 0;
  const flush = async () => {
    for (const entry of buffer) {
      await writer.writeLine(entry.line, entry.lineBytes);
    }
    buffer = [];
    bufferBytes = 0;
  };
  try {
    for (const entry of rows) {
      const line = stringify(entry);
      const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
      buffer.push({ line, lineBytes });
      bufferBytes += lineBytes;
      if ((maxBufferRows && buffer.length >= maxBufferRows)
        || (maxBufferBytes && bufferBytes >= maxBufferBytes)) {
        await flush();
      }
    }
    if (buffer.length) await flush();
    await writer.close();
  } catch (err) {
    try { await writer.destroy(err); } catch {}
    throw err;
  }
};

export const mergeSortedRuns = async function* (
  runs,
  {
    compare,
    readRun = readJsonlRows,
    validateComparator = false
  } = {}
) {
  const compareFn = createComparator(compare, { validateComparator });
  const advance = async (cursor) => {
    const next = await cursor.iterator.next();
    if (next.done) {
      cursor.done = true;
      cursor.row = null;
      return false;
    }
    cursor.row = next.value;
    return true;
  };
  const heap = new MinHeap((a, b) => {
    const cmp = compareFn(a.row, b.row);
    if (cmp !== 0) return cmp;
    return a.order - b.order;
  });
  for (let i = 0; i < runs.length; i += 1) {
    const runPath = resolveRunPath(runs[i]);
    if (!runPath) continue;
    const iterator = readRun(runPath)[Symbol.asyncIterator]();
    const cursor = { iterator, row: null, done: false, order: i };
    const hasRow = await advance(cursor);
    if (hasRow) heap.push(cursor);
  }
  while (heap.size) {
    const best = heap.pop();
    if (!best) break;
    yield best.row;
    const hasMore = await advance(best);
    if (hasMore) heap.push(best);
  }
};

export const mergeSortedRunsToFile = async ({
  runs,
  outputPath,
  compare,
  readRun = readJsonlRows,
  serialize = null,
  maxBufferRows = DEFAULT_MAX_BUFFER_ROWS,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  validateComparator = false,
  atomic = true,
  onStats = null
} = {}) => {
  if (!outputPath) throw new Error('mergeSortedRunsToFile requires outputPath');
  const stringify = typeof serialize === 'function' ? serialize : (value) => JSON.stringify(value);
  const writer = createJsonlBatchWriter(outputPath, { atomic });
  const stats = {
    rows: 0,
    bytes: 0,
    maxRowBytes: 0,
    startedAt: Date.now(),
    finishedAt: null,
    elapsedMs: 0
  };
  let buffer = [];
  let bufferBytes = 0;
  const flush = async () => {
    for (const entry of buffer) {
      await writer.writeLine(entry.line, entry.lineBytes);
    }
    buffer = [];
    bufferBytes = 0;
  };
  try {
    for await (const row of mergeSortedRuns(runs, { compare, readRun, validateComparator })) {
      const line = stringify(row);
      const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
      stats.rows += 1;
      stats.bytes += lineBytes;
      stats.maxRowBytes = Math.max(stats.maxRowBytes, lineBytes);
      buffer.push({ line, lineBytes });
      bufferBytes += lineBytes;
      if ((maxBufferRows && buffer.length >= maxBufferRows)
        || (maxBufferBytes && bufferBytes >= maxBufferBytes)) {
        await flush();
      }
    }
    if (buffer.length) await flush();
    await writer.close();
  } catch (err) {
    try { await writer.destroy(err); } catch {}
    throw err;
  }
  stats.finishedAt = Date.now();
  stats.elapsedMs = stats.finishedAt - stats.startedAt;
  if (typeof onStats === 'function') {
    onStats(stats);
  }
  return stats;
};

const createRunPath = (dir, prefix, passIndex, groupIndex) => (
  path.join(
    dir,
    `${prefix}.pass-${String(passIndex).padStart(2, '0')}.run-${String(groupIndex).padStart(3, '0')}.jsonl`
  )
);

const chunkRuns = (runs, size) => {
  if (runs.length <= size) return [runs.slice()];
  const groups = [];
  for (let i = 0; i < runs.length; i += size) {
    groups.push(runs.slice(i, i + size));
  }
  return groups;
};

const readCheckpoint = async (checkpointPath) => {
  if (!checkpointPath) return null;
  try {
    const raw = await fsPromises.readFile(checkpointPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== MERGE_RUN_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCheckpoint = async (checkpointPath, payload) => {
  if (!checkpointPath) return;
  const tempPath = createTempPath(checkpointPath);
  await fsPromises.writeFile(tempPath, JSON.stringify(payload, null, 2));
  await replaceFile(tempPath, checkpointPath);
};

export const mergeRunsWithPlanner = async ({
  runs,
  outputPath,
  compare,
  readRun = readJsonlRows,
  serialize = null,
  maxOpenRuns = DEFAULT_MAX_OPEN_RUNS,
  tempDir = null,
  runPrefix = 'merge',
  compareId = null,
  validateComparator = false,
  checkpointPath = null
} = {}) => {
  if (!Array.isArray(runs) || !runs.length) {
    throw new Error('mergeRunsWithPlanner requires runs');
  }
  if (!outputPath) throw new Error('mergeRunsWithPlanner requires outputPath');
  const resolvedTempDir = tempDir || path.dirname(outputPath);
  await fsPromises.mkdir(resolvedTempDir, { recursive: true });
  const cleanupPaths = [];
  const checkpoint = await readCheckpoint(checkpointPath);
  let passIndex = 0;
  let currentRuns = runs.slice();
  const checkpointState = checkpoint || {
    version: MERGE_RUN_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    passes: {}
  };

  while (currentRuns.length > maxOpenRuns) {
    const groups = chunkRuns(currentRuns, maxOpenRuns);
    const nextRuns = [];
    const passKey = String(passIndex);
    const passState = checkpointState.passes[passKey] || {};
    for (let i = 0; i < groups.length; i += 1) {
      const cached = passState[i];
      if (cached && cached.path && fs.existsSync(cached.path)) {
        nextRuns.push(cached.path);
        continue;
      }
      const runPath = createRunPath(resolvedTempDir, runPrefix, passIndex, i);
      const manifestPath = `${runPath}.meta.json`;
      const stats = await mergeSortedRunsToFile({
        runs: groups[i],
        outputPath: runPath,
        compare,
        readRun,
        serialize,
        validateComparator
      });
      const manifest = createMergeRunManifest({
        runPath,
        rows: stats.rows,
        bytes: stats.bytes,
        compareId,
        format: MERGE_RUN_FORMAT,
        sources: groups[i].map(resolveRunPath).filter(Boolean)
      });
      await writeMergeRunManifest(manifestPath, manifest);
      cleanupPaths.push(runPath, manifestPath);
      passState[i] = { path: runPath, manifestPath };
      checkpointState.passes[passKey] = passState;
      await writeCheckpoint(checkpointPath, checkpointState);
      nextRuns.push(runPath);
    }
    currentRuns = nextRuns;
    passIndex += 1;
  }

  const finalStats = await mergeSortedRunsToFile({
    runs: currentRuns,
    outputPath,
    compare,
    readRun,
    serialize,
    validateComparator
  });
  await writeCheckpoint(checkpointPath, checkpointState);

  const cleanup = async () => {
    for (const entry of cleanupPaths) {
      try { await fsPromises.rm(entry, { force: true, recursive: true }); } catch {}
    }
    if (checkpointPath) {
      try { await fsPromises.rm(checkpointPath, { force: true }); } catch {}
    }
  };

  return {
    outputPath,
    stats: finalStats,
    cleanup
  };
};
