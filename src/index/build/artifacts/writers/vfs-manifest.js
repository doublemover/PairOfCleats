import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { log } from '../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import { ensureDiskSpace } from '../../../../shared/disk-space.js';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { stringifyJsonValue } from '../../../../shared/json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from '../../../../shared/json-stream/streams.js';
import { fromPosix } from '../../../../shared/files.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';
import {
  compareVfsManifestRows,
  trimVfsManifestRow
} from '../../../tooling/vfs.js';
import { isVfsManifestCollector } from '../../vfs-manifest-collector.js';

const sortVfsRows = (rows) => rows.sort(compareVfsManifestRows);

const resolveJsonlExtension = (value) => {
  if (value === 'gzip') return 'jsonl.gz';
  if (value === 'zstd') return 'jsonl.zst';
  return 'jsonl';
};

const resolveLineBytes = (value) => {
  const line = stringifyJsonValue(value);
  return Buffer.byteLength(line, 'utf8') + 1;
};

const measureRows = (rows) => {
  let totalBytes = 0;
  let maxLineBytes = 0;
  for (const row of rows) {
    const bytes = resolveLineBytes(row);
    totalBytes += bytes;
    if (bytes > maxLineBytes) maxLineBytes = bytes;
  }
  return { totalBytes, maxLineBytes, totalRecords: rows.length };
};

const trimRows = (rows, { log: logFn } = {}) => rows
  .map((row) => trimVfsManifestRow(row, { log: logFn }))
  .filter(Boolean);

const readJsonlRows = async function* (filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of rl) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        yield row;
      } catch (err) {
        const message = err?.message || 'JSON parse error';
        throw new Error(`Invalid vfs_manifest run JSON at ${filePath}:${lineNumber}: ${message}`);
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
};

const mergeSortedRuns = async function* (runs) {
  const cursors = [];
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
  for (const runPath of runs) {
    const iterator = readJsonlRows(runPath)[Symbol.asyncIterator]();
    const cursor = { iterator, row: null, done: false };
    const hasRow = await advance(cursor);
    if (hasRow) cursors.push(cursor);
  }
  while (cursors.length) {
    let bestIndex = 0;
    for (let i = 1; i < cursors.length; i += 1) {
      if (compareVfsManifestRows(cursors[i].row, cursors[bestIndex].row) < 0) {
        bestIndex = i;
      }
    }
    const best = cursors[bestIndex];
    const row = best.row;
    yield row;
    const hasMore = await advance(best);
    if (!hasMore) {
      cursors.splice(bestIndex, 1);
    }
  }
};

const writeJsonLinesFileAsync = async (filePath, items, options = {}) => {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null
  } = options;
  const { stream, done } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal
  });
  try {
    for await (const item of items) {
      await writeChunk(stream, stringifyJsonValue(item));
      await writeChunk(stream, '\n');
    }
    stream.end();
    await done;
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
};

const writeJsonLinesShardedAsync = async (input) => {
  const {
    dir,
    partsDirName,
    partPrefix,
    items,
    maxBytes,
    maxItems = 0,
    atomic = false,
    compression = null,
    gzipOptions = null,
    highWaterMark = null,
    signal = null
  } = input || {};
  const resolvedMaxBytes = Number.isFinite(Number(maxBytes)) ? Math.max(0, Math.floor(Number(maxBytes))) : 0;
  const resolvedMaxItems = Number.isFinite(Number(maxItems)) ? Math.max(0, Math.floor(Number(maxItems))) : 0;
  const partsDir = path.join(dir, partsDirName);
  await fsPromises.rm(partsDir, { recursive: true, force: true });
  await fsPromises.mkdir(partsDir, { recursive: true });

  const extension = resolveJsonlExtension(compression);

  const parts = [];
  const counts = [];
  const bytes = [];
  let total = 0;
  let totalBytes = 0;
  let partIndex = -1;
  let partCount = 0;
  let partLogicalBytes = 0;
  let current = null;
  let currentPath = null;

  const closePart = async () => {
    if (!current) return;
    current.stream.end();
    await current.done;
    if (currentPath) {
      try {
        const stat = await fsPromises.stat(currentPath);
        bytes[bytes.length - 1] = stat.size;
        totalBytes += stat.size;
      } catch {}
    }
    current = null;
    currentPath = null;
  };

  const openPart = () => {
    partIndex += 1;
    partCount = 0;
    partLogicalBytes = 0;
    const partName = `${partPrefix}${String(partIndex).padStart(5, '0')}.${extension}`;
    const absPath = path.join(partsDir, partName);
    const relPath = path.posix.join(partsDirName, partName);
    parts.push(relPath);
    counts.push(0);
    bytes.push(0);
    current = createJsonWriteStream(absPath, {
      atomic,
      compression,
      gzipOptions,
      highWaterMark,
      signal
    });
    currentPath = absPath;
  };

  try {
    for await (const item of items) {
      const line = stringifyJsonValue(item);
      const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
      const needsNewPart = current
        && ((resolvedMaxItems && partCount >= resolvedMaxItems)
          || (resolvedMaxBytes && (partLogicalBytes + lineBytes) > resolvedMaxBytes));
      if (!current || needsNewPart) {
        await closePart();
        openPart();
      }
      await writeChunk(current.stream, line);
      await writeChunk(current.stream, '\n');
      partCount += 1;
      partLogicalBytes += lineBytes;
      total += 1;
      counts[counts.length - 1] = partCount;
      if (resolvedMaxBytes && lineBytes > resolvedMaxBytes && partCount === 1) {
        const err = new Error(
          `JSONL entry exceeds maxBytes (${lineBytes} > ${resolvedMaxBytes}) in ${partsDirName}`
        );
        err.code = 'ERR_JSON_TOO_LARGE';
        throw err;
      }
      if (resolvedMaxBytes && partLogicalBytes >= resolvedMaxBytes) {
        await closePart();
      }
    }
    await closePart();
  } catch (err) {
    if (current?.stream) {
      try { current.stream.destroy(err); } catch {}
      try { await current.done; } catch {}
    }
    throw err;
  }

  const maxPartRecords = counts.length ? Math.max(...counts) : 0;
  const maxPartBytes = bytes.length ? Math.max(...bytes) : 0;
  const targetMaxBytes = resolvedMaxBytes > 0 ? resolvedMaxBytes : null;
  return {
    parts,
    counts,
    bytes,
    total,
    totalBytes,
    partsDir,
    maxPartRecords,
    maxPartBytes,
    targetMaxBytes
  };
};

const resolveRowsInput = async ({ rows, log: logFn }) => {
  if (isVfsManifestCollector(rows)) {
    const finalized = await rows.finalize();
    const stats = finalized?.stats || {};
    return {
      rows: Array.isArray(finalized.rows) ? finalized.rows : null,
      runs: Array.isArray(finalized.runs) ? finalized.runs : null,
      measurement: {
        totalBytes: stats.totalBytes || 0,
        maxLineBytes: stats.maxLineBytes || 0,
        totalRecords: stats.totalRecords || (Array.isArray(finalized.rows) ? finalized.rows.length : 0)
      },
      cleanup: typeof finalized.cleanup === 'function' ? finalized.cleanup : async () => {}
    };
  }

  const vfsRows = Array.isArray(rows) ? rows.slice() : [];
  const trimmedRows = trimRows(vfsRows, { log: logFn });
  sortVfsRows(trimmedRows);
  return {
    rows: trimmedRows,
    runs: null,
    measurement: measureRows(trimmedRows),
    cleanup: async () => {}
  };
};

export const enqueueVfsManifestArtifacts = async ({
  outDir,
  mode,
  rows,
  maxJsonBytes = MAX_JSON_BYTES,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  const resolved = await resolveRowsInput({ rows, log });
  const measurement = resolved.measurement;
  const totalRecords = measurement.totalRecords || 0;
  if (!totalRecords) {
    await resolved.cleanup();
    await fsPromises.rm(path.join(outDir, 'vfs_manifest.jsonl'), { recursive: true, force: true }).catch(() => {});
    await fsPromises.rm(path.join(outDir, 'vfs_manifest.jsonl.gz'), { recursive: true, force: true }).catch(() => {});
    await fsPromises.rm(path.join(outDir, 'vfs_manifest.jsonl.zst'), { recursive: true, force: true }).catch(() => {});
    await fsPromises.rm(path.join(outDir, 'vfs_manifest.meta.json'), { recursive: true, force: true }).catch(() => {});
    await fsPromises.rm(path.join(outDir, 'vfs_manifest.parts'), { recursive: true, force: true }).catch(() => {});
    return;
  }
  if (maxJsonBytes && measurement.maxLineBytes > maxJsonBytes) {
    await resolved.cleanup();
    throw new Error(`vfs_manifest row exceeds max JSON size (${measurement.maxLineBytes} bytes).`);
  }
  const useShards = maxJsonBytes && measurement.totalBytes > maxJsonBytes;
  const jsonlExtension = resolveJsonlExtension(compression);
  const jsonlName = `vfs_manifest.${jsonlExtension}`;
  const jsonlPath = path.join(outDir, jsonlName);
  const removeArtifact = async (targetPath) => {
    try { await fsPromises.rm(targetPath, { recursive: true, force: true }); } catch {}
  };
  if (useShards) {
    await removeArtifact(path.join(outDir, 'vfs_manifest.jsonl'));
    await removeArtifact(path.join(outDir, 'vfs_manifest.jsonl.gz'));
    await removeArtifact(path.join(outDir, 'vfs_manifest.jsonl.zst'));
  } else {
    await removeArtifact(path.join(outDir, 'vfs_manifest.meta.json'));
    await removeArtifact(path.join(outDir, 'vfs_manifest.parts'));
  }
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: measurement.totalBytes,
    label: mode ? `${mode} vfs_manifest` : 'vfs_manifest'
  });

  if (useShards) {
    const metaPath = path.join(outDir, 'vfs_manifest.meta.json');
    enqueueWrite(
      formatArtifactLabel(metaPath),
      async () => {
        try {
          const result = resolved.rows
            ? await writeJsonLinesSharded({
              dir: outDir,
              partsDirName: 'vfs_manifest.parts',
              partPrefix: 'vfs_manifest.part-',
              items: resolved.rows,
              maxBytes: maxJsonBytes,
              maxItems: 100000,
              atomic: true,
              compression,
              gzipOptions
            })
            : await writeJsonLinesShardedAsync({
              dir: outDir,
              partsDirName: 'vfs_manifest.parts',
              partPrefix: 'vfs_manifest.part-',
              items: mergeSortedRuns(resolved.runs || []),
              maxBytes: maxJsonBytes,
              maxItems: 100000,
              atomic: true,
              compression,
              gzipOptions
            });
          const parts = result.parts.map((part, index) => ({
            path: part,
            records: result.counts[index] || 0,
            bytes: result.bytes[index] || 0
          }));
          await writeJsonObjectFile(metaPath, {
            fields: {
              schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
              artifact: 'vfs_manifest',
              format: 'jsonl-sharded',
              generatedAt: new Date().toISOString(),
              compression: compression || 'none',
              totalRecords: result.total,
              totalBytes: result.totalBytes,
              maxPartRecords: result.maxPartRecords,
              maxPartBytes: result.maxPartBytes,
              targetMaxBytes: result.targetMaxBytes,
              parts
            },
            atomic: true
          });
          for (let i = 0; i < result.parts.length; i += 1) {
            const relPath = result.parts[i];
            const absPath = path.join(outDir, fromPosix(relPath));
            addPieceFile({
              type: 'tooling',
              name: 'vfs_manifest',
              format: 'jsonl',
              count: result.counts[i] || 0,
              compression: compression || null
            }, absPath);
          }
          addPieceFile({ type: 'tooling', name: 'vfs_manifest_meta', format: 'json' }, metaPath);
        } finally {
          await resolved.cleanup();
        }
      }
    );
    return;
  }

  enqueueWrite(
    formatArtifactLabel(jsonlPath),
    async () => {
      try {
        if (resolved.rows) {
          await writeJsonLinesFile(
            jsonlPath,
            resolved.rows,
            { atomic: true, compression, gzipOptions }
          );
        } else {
          await writeJsonLinesFileAsync(
            jsonlPath,
            mergeSortedRuns(resolved.runs || []),
            { atomic: true, compression, gzipOptions }
          );
        }
      } finally {
        await resolved.cleanup();
      }
    }
  );
  addPieceFile({
    type: 'tooling',
    name: 'vfs_manifest',
    format: 'jsonl',
    count: totalRecords,
    compression: compression || null
  }, jsonlPath);
  if (measurement.totalBytes > MAX_JSON_BYTES * 0.9) {
    log(`[vfs] vfs_manifest ~${Math.round(measurement.totalBytes / 1024)}KB; consider sharding.`);
  }
};
