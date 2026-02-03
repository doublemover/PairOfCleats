import fs from 'node:fs/promises';
import path from 'node:path';
import { stringifyJsonValue } from '../../shared/json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from '../../shared/json-stream/streams.js';
import {
  compareVfsManifestRows,
  trimVfsManifestRow
} from '../tooling/vfs.js';

const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_BUFFER_ROWS = 5000;
const RUNS_DIR_NAME = 'vfs_manifest.runs';
const COLLECTOR_KIND = 'vfs_manifest_collector';

const createStats = () => ({
  totalBytes: 0,
  maxLineBytes: 0,
  totalRecords: 0,
  trimmedRows: 0,
  droppedRows: 0,
  runsSpilled: 0
});

const resolveLineBytes = (value) => {
  const line = stringifyJsonValue(value);
  return Buffer.byteLength(line, 'utf8') + 1;
};

const ensureRunsDir = async (baseDir, current) => {
  if (current) return current;
  const root = baseDir || process.cwd();
  const target = path.join(root, RUNS_DIR_NAME);
  await fs.mkdir(target, { recursive: true });
  return target;
};

const writeRunFile = async (runPath, rows) => {
  const { stream, done } = createJsonWriteStream(runPath, { atomic: true });
  try {
    for (const row of rows) {
      await writeChunk(stream, stringifyJsonValue(row));
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

/**
 * Test if a value is a VFS manifest collector.
 * @param {unknown} value
 * @returns {boolean}
 */
export const isVfsManifestCollector = (value) => (
  value && typeof value === 'object' && value.kind === COLLECTOR_KIND && typeof value.finalize === 'function'
);

/**
 * Create a spill-to-disk collector for VFS manifest rows.
 *
 * Deterministic: run files are sorted by row order and merged later.
 * Side effects: writes run files under buildRoot when buffers spill.
 *
 * @param {{ buildRoot?: string|null, maxBufferBytes?: number, maxBufferRows?: number, log?: Function|null }} [options]
 * @returns {{ kind: string, appendRows: Function, finalize: Function, stats: object }}
 */
export const createVfsManifestCollector = ({
  buildRoot,
  maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
  maxBufferRows = DEFAULT_MAX_BUFFER_ROWS,
  log = null
} = {}) => {
  const buffer = [];
  let bufferBytes = 0;
  let runsDir = null;
  let runIndex = 0;
  const runs = [];
  const stats = createStats();

  const spill = async () => {
    if (!buffer.length) return;
    buffer.sort(compareVfsManifestRows);
    runsDir = await ensureRunsDir(buildRoot, runsDir);
    const runName = `vfs_manifest.run-${String(runIndex).padStart(5, '0')}.jsonl`;
    const runPath = path.join(runsDir, runName);
    runIndex += 1;
    await writeRunFile(runPath, buffer);
    runs.push(runPath);
    stats.runsSpilled += 1;
    buffer.length = 0;
    bufferBytes = 0;
  };

  const appendRow = async (row, rowLog) => {
    const trimmed = trimVfsManifestRow(row, { log: rowLog || log, stats });
    if (!trimmed) return;
    const lineBytes = resolveLineBytes(trimmed);
    stats.totalBytes += lineBytes;
    stats.maxLineBytes = Math.max(stats.maxLineBytes, lineBytes);
    stats.totalRecords += 1;
    buffer.push(trimmed);
    bufferBytes += lineBytes;
    const bufferOverflow = (maxBufferBytes && bufferBytes >= maxBufferBytes)
      || (maxBufferRows && buffer.length >= maxBufferRows);
    if (bufferOverflow) {
      await spill();
    }
  };

  const appendRows = async (rows, { log: rowLog } = {}) => {
    if (!Array.isArray(rows) || !rows.length) return;
    for (const row of rows) {
      await appendRow(row, rowLog);
    }
  };

  const finalize = async () => {
    if (runs.length) {
      if (buffer.length) await spill();
      return {
        kind: COLLECTOR_KIND,
        runs: runs.slice(),
        stats,
        cleanup: async () => {
          if (runsDir) {
            await fs.rm(runsDir, { recursive: true, force: true });
          }
        }
      };
    }
    if (buffer.length) {
      buffer.sort(compareVfsManifestRows);
    }
    return {
      kind: COLLECTOR_KIND,
      rows: buffer,
      stats,
      cleanup: async () => {
        if (runsDir) {
          await fs.rm(runsDir, { recursive: true, force: true });
        }
      }
    };
  };

  return {
    kind: COLLECTOR_KIND,
    appendRows,
    finalize,
    stats
  };
};
