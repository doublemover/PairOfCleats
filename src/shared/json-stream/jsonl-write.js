import { stringifyJsonValue } from './encode.js';
import { createJsonlBatchWriter } from './jsonl-batch.js';
import { createOffsetsWriter } from './offsets.js';
import { throwIfAborted } from './runtime.js';

const resolveJsonlLine = (item) => {
  if (item && typeof item === 'object' && typeof item.__jsonl === 'string') {
    return item.__jsonl;
  }
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
  for await (const item of items) {
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
  }
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
  validateOffsetsConfig(offsets, compression);
  const writer = createWriter(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    preallocateBytes
  });
  const offsetsWriter = createOffsetsTarget(offsets, atomic, highWaterMark);
  try {
    await writeJsonlItems(writer, offsetsWriter, items, signal, resolvedMaxBytes);
    await writer.close();
    if (offsetsWriter) await offsetsWriter.close();
  } catch (err) {
    try { await writer.destroy(err); } catch {}
    if (offsetsWriter) {
      await offsetsWriter.destroy(err);
    }
    throw err;
  }
};

export async function writeJsonLinesFile(filePath, items, options = {}) {
  await runJsonlWrite(filePath, items, options);
}

export async function writeJsonLinesFileAsync(filePath, items, options = {}) {
  await runJsonlWrite(filePath, items, options);
}

export { resolveJsonlLine };
