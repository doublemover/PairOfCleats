import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { loadGraphRelationsSync, loadJsonArrayArtifactSync, readJsonFile } from '../../shared/artifact-io.js';
import { mergeSortedRuns } from '../../shared/merge.js';
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
          items: mergeSortedRuns(runs, { compare }),
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
