import { writeJsonValue, writeArrayItems } from './encode.js';
import { createJsonWriteStream, writeChunk } from './streams.js';
import { throwIfAborted } from './runtime.js';

const finalizeJsonWrite = async ({
  stream,
  done,
  getBytesWritten,
  getChecksum,
  checksumAlgo
}) => {
  stream.end();
  await done;
  const checksum = typeof getChecksum === 'function' ? getChecksum() : null;
  return {
    bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : 0,
    checksum: checksum || null,
    checksumAlgo: checksumAlgo || null,
    checksumHash: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null
  };
};

const abortJsonWrite = async (stream, done, err) => {
  try { stream.destroy(err); } catch {}
  try { await done; } catch {}
};

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
    return finalizeJsonWrite({
      stream,
      done,
      getBytesWritten,
      getChecksum,
      checksumAlgo: resolvedChecksumAlgo
    });
  } catch (err) {
    await abortJsonWrite(stream, done, err);
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
    return finalizeJsonWrite({
      stream,
      done,
      getBytesWritten,
      getChecksum,
      checksumAlgo: resolvedChecksumAlgo
    });
  } catch (err) {
    await abortJsonWrite(stream, done, err);
    throw err;
  }
}
