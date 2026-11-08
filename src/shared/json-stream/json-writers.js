import { writeJsonValue, writeArrayItems } from './encode.js';
import { createJsonWriteStream, writeChunk } from './streams.js';
import { throwIfAborted } from './runtime.js';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { readPreparedJsonlRow } from './prepared-row.js';

// One serialization owner fans encoded bytes out to bounded writable sinks.
// Join all finalizers before exposing either representation to publication.
const createJsonOutput = async (filePath, options) => {
  const { additionalOutputs = [], ...primaryOptions } = options;
  if (!additionalOutputs.length) return createJsonWriteStream(filePath, primaryOptions);
  const sinks = [];
  let stream;
  try {
    for (const target of [{ filePath, ...primaryOptions }, ...additionalOutputs]) {
      const { filePath: targetPath, ...targetOptions } = target;
      const sink = createJsonWriteStream(targetPath, targetOptions);
      sinks.push({ ...sink, filePath: targetPath });
      sink.done.catch(error => stream?.destroy(error));
    }
  } catch (error) {
    let primary = error;
    for (const sink of sinks) {
      try { sink.stream.destroy(error); } catch (cleanupError) {
        primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
      }
    }
    const settled = await Promise.allSettled(sinks.map(sink => sink.done));
    for (const outcome of settled) if (outcome.status === 'rejected' && outcome.reason !== error) {
      primary = addStorageFailureContext(primary, {}, outcome.reason, { secondaryPresent: true });
    }
    throw primary;
  }
  stream = new Writable({
    highWaterMark: options.highWaterMark || 64 * 1024,
    write(chunk, encoding, callback) {
      Promise.all(sinks.map(sink => writeChunk(sink.stream, chunk))).then(() => callback(), callback);
    },
    final(callback) {
      for (const sink of sinks) sink.stream.end();
      Promise.all(sinks.map(sink => sink.done)).then(() => callback(), callback);
    },
    destroy(error, callback) {
      for (const sink of sinks) if (!sink.stream.destroyed) sink.stream.destroy(error);
      callback(error);
    }
  });
  const done = finished(stream).catch(async error => {
    const settled = await Promise.allSettled(sinks.map(sink => sink.done));
    let primary = error;
    for (const outcome of settled) if (outcome.status === 'rejected' && outcome.reason !== error) {
      primary = addStorageFailureContext(primary, {}, outcome.reason, { secondaryPresent: true });
    }
    throw primary;
  });
  done.catch(() => {});
  return { ...sinks[0], stream, done,
    getAdditionalResults: () => sinks.slice(1).map(sink => ({
      filePath: sink.filePath, bytes: sink.getBytesWritten(),
      checksum: sink.getChecksum(), checksumAlgo: sink.checksumAlgo
    })) };
};

const finalizeJsonWrite = async ({
  stream,
  done,
  getBytesWritten,
  getChecksum,
  checksumAlgo,
  getAdditionalResults
}) => {
  stream.end();
  await done;
  const checksum = typeof getChecksum === 'function' ? getChecksum() : null;
  return {
    bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : 0,
    checksum: checksum || null,
    checksumAlgo: checksumAlgo || null,
    checksumHash: checksum && checksumAlgo ? `${checksumAlgo}:${checksum}` : null,
    ...(getAdditionalResults ? { additionalResults: getAdditionalResults() } : {})
  };
};

export const abortJsonWrite = async (stream, done, err) => {
  let primary = err;
  try { stream.destroy(err); } catch (error) {
    if (error !== err) primary = addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
  }
  try { await done; } catch (error) {
    if (error !== err) primary = addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
  }
  return primary;
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
  const { stream, done, getBytesWritten, getChecksum, getAdditionalResults, checksumAlgo: resolvedChecksumAlgo } = await createJsonOutput(filePath, {
    additionalOutputs: options.additionalOutputs,
    compression,
    atomic,
    gzipOptions,
    highWaterMark,
    signal,
    checksumAlgo
  });
  try {
    await writeChunk(stream, '[');
    await writeArrayItems(stream, items, signal, readPreparedJsonlRow);
    await writeChunk(stream, ']');
    if (trailingNewline) await writeChunk(stream, '\n');
    return finalizeJsonWrite({
      stream,
      done,
      getBytesWritten,
      getChecksum,
      checksumAlgo: resolvedChecksumAlgo,
      getAdditionalResults
    });
  } catch (err) {
    throw await abortJsonWrite(stream, done, err);
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
  const { stream, done, getBytesWritten, getChecksum, getAdditionalResults, checksumAlgo: resolvedChecksumAlgo } = await createJsonOutput(filePath, {
    additionalOutputs: input.additionalOutputs,
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
      await writeJsonValue(stream, value, { signal });
      first = false;
    }
    for (const [key, items] of Object.entries(arrays)) {
      throwIfAborted(signal);
      const header = `${JSON.stringify(key)}:[`;
      await writeChunk(stream, `${first ? '' : ','}${header}`);
      first = false;
      await writeArrayItems(stream, items, signal, readPreparedJsonlRow);
      await writeChunk(stream, ']');
    }
    await writeChunk(stream, '}');
    if (trailingNewline) await writeChunk(stream, '\n');
    return finalizeJsonWrite({
      stream,
      done,
      getBytesWritten,
      getChecksum,
      checksumAlgo: resolvedChecksumAlgo,
      getAdditionalResults
    });
  } catch (err) {
    throw await abortJsonWrite(stream, done, err);
  }
}
