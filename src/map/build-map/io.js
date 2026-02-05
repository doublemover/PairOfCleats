import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { loadGraphRelationsSync, loadJsonArrayArtifactSync, readJsonFile } from '../../shared/artifact-io.js';
import { createJsonWriteStream, writeChunk } from '../../shared/json-stream/streams.js';
import { stringifyJsonValue, writeJsonValue } from '../../shared/json-stream/encode.js';
import { writeJsonLinesFile } from '../../shared/json-stream.js';

export const readJsonOptional = (filePath, warnings) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return readJsonFile(filePath);
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    warnings.push(`Failed to read ${filePath}${detail}`);
    return null;
  }
};

export const readJsonArrayOptional = (dir, baseName, warnings) => {
  try {
    return loadJsonArrayArtifactSync(dir, baseName);
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    warnings.push(`Failed to read ${baseName}${detail}`);
    return null;
  }
};

export const readGraphRelationsOptional = (dir, warnings, { strict = true } = {}) => {
  try {
    return loadGraphRelationsSync(dir, { strict });
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    warnings.push(`Failed to read graph_relations${detail}`);
    return null;
  }
};

export const hydrateChunkMeta = (chunks, fileMetaRaw) => {
  if (!Array.isArray(chunks)) return [];
  if (!Array.isArray(fileMetaRaw)) return chunks;
  const fileMetaById = new Map();
  for (const entry of fileMetaRaw) {
    if (!entry || entry.id == null) continue;
    fileMetaById.set(entry.id, entry);
  }
  for (const chunk of chunks) {
    if (!chunk || (chunk.file && chunk.ext)) continue;
    const meta = fileMetaById.get(chunk.fileId);
    if (!meta) continue;
    if (!chunk.file) chunk.file = meta.file;
    if (!chunk.ext) chunk.ext = meta.ext;
  }
  return chunks;
};

export const resolveJsonBytes = (value) => Buffer.byteLength(stringifyJsonValue(value), 'utf8');

const createGuard = ({ label, maxBytes, optionName }) => {
  const cap = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : null;
  let used = 0;
  return {
    add(bytes) {
      if (!cap || cap <= 0) return;
      used += bytes;
      if (used > cap) {
        const hint = optionName ? ` Increase ${optionName} or reduce map size.` : '';
        throw new Error(`Map build guardrail hit for ${label} (${used} > ${cap} bytes).${hint}`);
      }
    },
    getBytes() {
      return used;
    },
    maxBytes: cap
  };
};

export const writeJsonArrayStream = async (stream, items, { guard, onItem } = {}) => {
  await writeChunk(stream, '[');
  let first = true;
  for await (const item of items) {
    if (!first) await writeChunk(stream, ',');
    const json = stringifyJsonValue(item);
    if (guard) guard.add(Buffer.byteLength(json, 'utf8'));
    await writeChunk(stream, json);
    if (typeof onItem === 'function') onItem(item);
    first = false;
  }
  await writeChunk(stream, ']');
};

export const writeMapJsonStream = async ({
  filePath,
  mapBase,
  nodes,
  edges,
  guards = {}
}) => {
  const { stream, done } = createJsonWriteStream(filePath, { atomic: true });
  try {
    await writeChunk(stream, '{');
    let first = true;
    const writeField = async (key, value, writer) => {
      if (!first) await writeChunk(stream, ',');
      await writeChunk(stream, `${JSON.stringify(key)}:`);
      if (writer) {
        await writer();
      } else {
        await writeJsonValue(stream, value);
      }
      first = false;
    };

    const orderedKeys = [
      'version',
      'generatedAt',
      'root',
      'mode',
      'options',
      'legend',
      'nodes',
      'edges',
      'edgeAggregates',
      'viewer',
      'summary',
      'sectionHashes',
      'buildMetrics',
      'warnings'
    ];

    for (const key of orderedKeys) {
      if (key === 'nodes') {
        await writeField('nodes', null, async () => {
          await writeJsonArrayStream(stream, nodes, { guard: guards.nodes });
        });
        continue;
      }
      if (key === 'edges') {
        await writeField('edges', null, async () => {
          await writeJsonArrayStream(stream, edges, { guard: guards.edges });
        });
        continue;
      }
      if (!(key in mapBase)) continue;
      await writeField(key, mapBase[key]);
    }
    await writeChunk(stream, '}');
    stream.end();
    await done;
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
};

class MinHeap {
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

const readJsonlRows = async function* (filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let lineNumber = 0;
  let buffer = '';
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
          yield JSON.parse(trimmed);
        } catch (err) {
          const message = err?.message || 'JSON parse error';
          throw new Error(`Invalid map spill JSON at ${filePath}:${lineNumber}: ${message}`);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const trimmed = buffer.trim();
    if (trimmed) {
      lineNumber += 1;
      try {
        yield JSON.parse(trimmed);
      } catch (err) {
        const message = err?.message || 'JSON parse error';
        throw new Error(`Invalid map spill JSON at ${filePath}:${lineNumber}: ${message}`);
      }
    }
  } finally {
    if (!stream.destroyed) stream.destroy();
  }
};

const mergeSortedRuns = async function* (runs, compare) {
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
    const cmp = compare(a.row, b.row);
    if (cmp !== 0) return cmp;
    return a.order - b.order;
  });
  for (let i = 0; i < runs.length; i += 1) {
    const iterator = readJsonlRows(runs[i])[Symbol.asyncIterator]();
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

export const createSpillSorter = ({ label, compare, maxInMemory = 5000, tempDir }) => {
  const buffer = [];
  const runs = [];
  let total = 0;
  let runIndex = 0;
  const resolvedMax = Number.isFinite(Number(maxInMemory)) ? Math.max(1, Math.floor(Number(maxInMemory))) : 5000;
  const flush = async () => {
    if (!buffer.length) return;
    buffer.sort(compare);
    const runPath = path.join(tempDir, `${label}-${runIndex += 1}.jsonl`);
    await writeJsonLinesFile(runPath, buffer);
    runs.push(runPath);
    buffer.length = 0;
  };
  return {
    async push(item) {
      buffer.push(item);
      total += 1;
      if (buffer.length >= resolvedMax) {
        await flush();
      }
    },
    async finalize() {
      if (runs.length) {
        if (buffer.length) await flush();
        return {
          items: mergeSortedRuns(runs, compare),
          total,
          spilled: true,
          runs
        };
      }
      buffer.sort(compare);
      return { items: buffer, total, spilled: false, runs: [] };
    },
    async cleanup() {
      if (!runs.length) return;
      await Promise.all(runs.map((runPath) => fsPromises.rm(runPath, { force: true })));
    },
    get total() {
      return total;
    }
  };
};

export const createMapSectionGuards = ({ maxNodeBytes, maxEdgeBytes, maxSymbolBytes } = {}) => ({
  nodes: createGuard({ label: 'nodes', maxBytes: maxNodeBytes, optionName: '--max-node-bytes' }),
  edges: createGuard({ label: 'edges', maxBytes: maxEdgeBytes, optionName: '--max-edge-bytes' }),
  symbols: createGuard({ label: 'symbols', maxBytes: maxSymbolBytes, optionName: '--max-symbol-bytes' })
});
