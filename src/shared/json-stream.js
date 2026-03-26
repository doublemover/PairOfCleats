import { createTempPath, replaceFile } from './json-stream/atomic.js';
import { writeJsonValue, writeArrayItems } from './json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from './json-stream/streams.js';
import { throwIfAborted } from './json-stream/runtime.js';

export { createTempPath, replaceFile };
export {
  resolveJsonlExtension,
  writeJsonLinesFile,
  writeJsonLinesFileAsync
} from './json-stream/jsonl-write.js';
export {
  writeJsonLinesSharded,
  writeJsonLinesShardedAsync
} from './json-stream/jsonl-sharded.js';

export async function writeJsonArrayFile(filePath, items, options = {}) {
  const {
    trailingNewline = true,
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    checksumAlgo = null
  } = options;
  const { stream, done, getBytesWritten, getChecksum, checksumAlgo: resolvedChecksumAlgo } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    checksumAlgo
  });
  try {
    await writeChunk(stream, '[');
    await writeArrayItems(stream, items, signal);
    await writeChunk(stream, ']');
    if (trailingNewline) await writeChunk(stream, '\n');
    stream.end();
    await done;
    const checksum = typeof getChecksum === 'function' ? getChecksum() : null;
    return {
      bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : 0,
      checksum: checksum || null,
      checksumAlgo: resolvedChecksumAlgo || null,
      checksumHash: checksum && resolvedChecksumAlgo ? `${resolvedChecksumAlgo}:${checksum}` : null
    };
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}

export async function writeJsonObjectFile(filePath, input = {}) {
  const {
    fields = {},
    arrays = {},
    trailingNewline = true,
    compression = null,
    atomic = false,
    gzipOptions = null,
    highWaterMark = null,
    signal = null,
    checksumAlgo = null
  } = input;
  const { stream, done, getBytesWritten, getChecksum, checksumAlgo: resolvedChecksumAlgo } = createJsonWriteStream(filePath, {
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    checksumAlgo
  });
  try {
    await writeChunk(stream, '{');
    let first = true;
    for (const [key, value] of Object.entries(fields)) {
      throwIfAborted(signal);
      if (!first) await writeChunk(stream, ',');
      await writeChunk(stream, `${JSON.stringify(key)}:`);
      await writeJsonValue(stream, value);
      first = false;
    }
    for (const [key, items] of Object.entries(arrays)) {
      throwIfAborted(signal);
      const header = `${JSON.stringify(key)}:[`;
      await writeChunk(stream, `${first ? '' : ','}${header}`);
      first = false;
      await writeArrayItems(stream, items, signal);
      await writeChunk(stream, ']');
    }
    await writeChunk(stream, '}');
    if (trailingNewline) await writeChunk(stream, '\n');
    stream.end();
    await done;
    const checksum = typeof getChecksum === 'function' ? getChecksum() : null;
    return {
      bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : 0,
      checksum: checksum || null,
      checksumAlgo: resolvedChecksumAlgo || null,
      checksumHash: checksum && resolvedChecksumAlgo ? `${resolvedChecksumAlgo}:${checksum}` : null
    };
  } catch (err) {
    try { stream.destroy(err); } catch {}
    try { await done; } catch {}
    throw err;
  }
}
