import { stringifyJsonValue } from './encode.js';
import { createJsonlBatchWriter } from './jsonl-batch.js';
import { createOffsetsWriter } from './offsets.js';
import { throwIfAborted } from './runtime.js';
import { readPreparedJsonlRow } from './prepared-row.js';
import { consumeJsonRows } from './consume-rows.js';
import { addStorageFailureContext } from '../storage/operation-error.js';

const resolveJsonlLine = (item) => {
  const prepared = readPreparedJsonlRow(item);
  if (prepared) return prepared.line;
  return stringifyJsonValue(item);
};

export const resolveJsonlExtension = (value) => {
  if (value === 'gzip') return 'jsonl.gz';
  if (value === 'zstd') return 'jsonl.zst';
  return 'jsonl';
};

const resolveMaxBytes = (value) => (
  Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
);

const createOffsetsTarget = (offsets, atomic, highWaterMark) => (
  offsets?.path
    ? createOffsetsWriter(offsets.path, { atomic: offsets.atomic ?? atomic, highWaterMark })
    : null
);

const writeJsonlItems = async (writer, offsetsWriter, items, signal, resolvedMaxBytes) => {
  let bytesWritten = 0;
  await consumeJsonRows(items, async item => {
    throwIfAborted(signal);
    const line = resolveJsonlLine(item);
    const lineBuffer = Buffer.from(line, 'utf8');
    const lineBytes = lineBuffer.length + 1;
    if (resolvedMaxBytes && lineBytes > resolvedMaxBytes) {
      const err = new Error(`JSONL entry exceeds maxBytes (${lineBytes} > ${resolvedMaxBytes}).`);
      err.code = 'ERR_JSON_TOO_LARGE';
      throw err;
    }
    if (offsetsWriter) {
      await offsetsWriter.writeOffset(bytesWritten);
    }
    await writer.writeLine(lineBuffer, lineBytes);
    bytesWritten += lineBytes;
  }, { signal, awaitSyncValues: true });
};

const createWriter = (filePath, options) => createJsonlBatchWriter(filePath, options);

const validateOffsetsConfig = (offsets, compression) => {
  if (offsets?.path && compression) {
    throw new Error('JSONL offsets require uncompressed output (compressed shards must be scanned).');
  }
};

const runJsonlWrite = async (filePath, items, options = {}) => {
  const {
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    offsets = null,
    maxBytes = null,
    preallocateBytes = null
  } = options;
  const resolvedMaxBytes = resolveMaxBytes(maxBytes);
  const resolvedCompression = compression === 'none' ? null : compression;
  validateOffsetsConfig(offsets, resolvedCompression);
  const writer = createWriter(filePath, {
    compression: resolvedCompression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    preallocateBytes,
    pool: options.pool, workerCount: options.workerCount, workerMaxInFlight: options.workerMaxInFlight,
    blockSize: options.blockSize, level: options.level, zstdLevel: options.zstdLevel
  });
  let offsetsWriter = null;
  try {
    offsetsWriter = createOffsetsTarget(offsets, atomic, highWaterMark);
    await writeJsonlItems(writer, offsetsWriter, items, signal, resolvedMaxBytes);
    await writer.close();
    if (offsetsWriter) await offsetsWriter.close();
  } catch (err) {
    let primary = err;
    try { await writer.destroy(err); } catch (error) {
      if (error !== err) primary = addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
    }
    if (offsetsWriter) {
      try { await offsetsWriter.destroy(err); } catch (error) {
        if (error !== err) primary = addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
      }
    }
    throw primary;
  }
};

export async function writeJsonLinesFile(filePath, items, options = {}) {
  await runJsonlWrite(filePath, items, options);
}

export async function writeJsonLinesFileAsync(filePath, items, options = {}) {
  await runJsonlWrite(filePath, items, options);
}

export { resolveJsonlLine };
