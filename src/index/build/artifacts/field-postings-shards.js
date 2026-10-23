import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { writeJsonValue } from '../../../shared/json-stream/encode.js';
import { createJsonWriteStream, writeChunk } from '../../../shared/json-stream/streams.js';
import { writeJsonObjectFile } from '../../../shared/json-stream/json-writers.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { streamFieldPostingsShardBody } from './field-postings-shard-stream.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

export const FIELD_POSTINGS_FRAGMENT_LAYOUT = 'json-byte-fragments-v1';
const PREFIX = Buffer.from('{"fields":{'), SUFFIX = Buffer.from('}}\n');
const integrityFailure = message => Object.assign(new Error(message), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });

const exists = async filename => {
  try { await fs.lstat(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

/** A fragment is opaque encoded JSON bytes, not a separately parseable field.
 * Concatenation in offset order is the complete legacy document, including its
 * framing. UTF-8 and JSON escapes may cross fragment boundaries unchanged.
 */
export const writeFieldPostingsFragments = async ({ directory, fields, maxPartBytes, signal = null }) => {
  if (!Number.isSafeInteger(maxPartBytes) || maxPartBytes < 1) throw new TypeError('Field postings require a positive encoded-byte shard cap.');
  await fs.mkdir(directory, { recursive: true });
  const parts = [];
  let current = null, totalBytes = 0;
  const closePart = async () => {
    if (!current) return;
    current.stream.end();
    await current.done;
    parts.push({ filename: current.filename, offset: totalBytes, bytes: current.bytes,
      checksum: current.getChecksum(), checksumAlgo: current.checksumAlgo });
    totalBytes += current.bytes;
    current = null;
  };
  const consume = async chunk => {
    for (let offset = 0; offset < chunk.length;) {
      throwIfAborted(signal);
      if (!current) {
        const filename = `field_postings.part-${String(parts.length).padStart(5, '0')}.bin`;
        current = { ...createJsonWriteStream(path.join(directory, filename), { signal, checksumAlgo: 'sha1' }), filename, bytes: 0 };
      }
      const length = Math.min(chunk.length - offset, maxPartBytes - current.bytes);
      // The encoder's current chunk stays owned until this Writable callback
      // settles. The disk stream retains that immutable buffer as necessary.
      await writeChunk(current.stream, chunk.subarray(offset, offset + length));
      current.bytes += length; offset += length;
      if (current.bytes === maxPartBytes) await closePart();
    }
  };
  const stream = new Writable({ highWaterMark: 64 * 1024,
    write(chunk, _encoding, callback) { consume(chunk).then(() => callback(), callback); }
  });
  const done = finished(stream); done.catch(() => {});
  const encodingTiming = {};
  try {
    await writeJsonValue(stream, { fields }, { signal, timing: encodingTiming });
    await writeChunk(stream, '\n');
    stream.end(); await done;
    await closePart();
    throwIfAborted(signal);
    return { parts, totalBytes, encodingTiming };
  } catch (error) {
    let primary = error;
    try { stream.destroy(error); } catch (cleanupError) {
      primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
    }
    try { await done; } catch (cleanupError) {
      if (cleanupError !== error) primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
    }
    if (current) {
      try { current.stream.destroy(error); } catch (cleanupError) {
        primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
      }
      try { await current.done; } catch (cleanupError) {
        if (cleanupError !== error) primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
      }
    }
    throw primary;
  }
};

export const mergeFieldPostingsFragments = async ({ root, parts, targetPath, expectedTotalBytes = null, signal = null, metrics = {} }) => {
  if (!Array.isArray(parts) || !parts.length) throw integrityFailure('Field-postings fragment sequence is empty.');
  let admittedBytes = 0;
  const filenames = new Set();
  for (const part of parts) {
    const filename = part?.absPath || path.join(root, part?.path || part?.filename || '');
    if (part?.offset !== admittedBytes || !Number.isSafeInteger(part?.bytes) || part.bytes <= 0
      || !Number.isSafeInteger(admittedBytes + part.bytes) || filenames.has(filename)) {
      throw integrityFailure('Field-postings fragment sequence is not a unique contiguous safe span.');
    }
    filenames.add(filename); admittedBytes += part.bytes;
  }
  if (expectedTotalBytes !== null && expectedTotalBytes !== admittedBytes) throw integrityFailure('Field-postings fragment total differs from its selected family.');
  const prefix = Buffer.alloc(PREFIX.length), suffix = Buffer.alloc(SUFFIX.length);
  let prefixBytes = 0, suffixBytes = 0;
  const output = createJsonWriteStream(targetPath, { atomic: true, checksumAlgo: 'sha1', signal });
  let offset = 0;
  try {
    for (const part of parts) {
      throwIfAborted(signal);
      if (part.offset !== offset || !Number.isSafeInteger(part.bytes) || part.bytes <= 0) {
        throw integrityFailure('Field-postings fragment sequence changed after admission.');
      }
      await streamFieldPostingsShardBody({ root, filename: part.absPath || path.join(root, part.path || part.filename),
        expected: { ...part }, signal, metrics, fragment: true, onChunk: async bytes => {
          const take = Math.min(PREFIX.length - prefixBytes, bytes.length);
          if (take) { bytes.copy(prefix, prefixBytes, 0, take); prefixBytes += take; }
          if (bytes.length >= SUFFIX.length) { bytes.copy(suffix, 0, bytes.length - SUFFIX.length); suffixBytes = SUFFIX.length; }
          else {
            const keep = Math.min(suffixBytes, SUFFIX.length - bytes.length);
            suffix.copy(suffix, 0, suffixBytes - keep, suffixBytes);
            bytes.copy(suffix, keep); suffixBytes = keep + bytes.length;
          }
          await writeChunk(output.stream, bytes);
        } });
      offset += part.bytes;
    }
    if (offset !== admittedBytes || prefixBytes !== PREFIX.length || suffixBytes !== SUFFIX.length
      || !prefix.equals(PREFIX) || !suffix.equals(SUFFIX)) throw integrityFailure('Field-postings fragments do not frame a complete selected document.');
    output.stream.end(); await output.done;
    return { bytes: output.getBytesWritten(), checksum: output.getChecksum(), checksumAlgo: output.checksumAlgo,
      serializationMs: 0, directFdStreaming: true };
  } catch (error) {
    let primary = error;
    try { output.stream.destroy(error); } catch (cleanupError) {
      primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
    }
    try { await output.done; } catch (cleanupError) {
      if (cleanupError !== error) primary = addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true });
    }
    throw primary;
  }
};

/** The existing scheduler admits one bounded encoder/output owner. Parts report
 * their exact encoded sizes; no equal-average field estimate authorizes a
 * dominant unbounded shard. Generation paths stay private until family close.
 */
export const enqueueFieldPostingsShards = async ({ outDir, fields, estimatedBytes, desiredShardCount,
  targetPartBytes, signal = null, enqueueWrite, addPieceFile, formatArtifactLabel }) => {
  const maxPartBytes = Math.max(1, Math.min(Math.floor(targetPartBytes),
    Math.max(1, Math.ceil(estimatedBytes / Math.max(1, desiredShardCount)))));
  if (!Number.isSafeInteger(maxPartBytes)) throw new TypeError('Invalid field-postings shard target.');
  const priorAuthority = await exists(path.join(outDir, 'pieces', 'manifest.json'))
    || await exists(path.join(outDir, 'field_postings.json'))
    || await exists(path.join(outDir, 'field_postings.shards.meta.json'))
    || await exists(path.join(outDir, 'field_postings.shards'));
  const generation = priorAuthority ? `field_postings.gen-${randomUUID()}` : '';
  const generationDir = path.join(outDir, generation);
  const shardsDir = path.join(generationDir, 'field_postings.shards');
  const metaPath = path.join(generationDir, 'field_postings.shards.meta.json');
  const legacyPath = path.join(generationDir, 'field_postings.json');
  enqueueWrite(formatArtifactLabel(legacyPath), async ({ setPhase } = {}) => {
    setPhase?.('materialize:field-postings-fragments');
    const started = performance.now();
    const written = await writeFieldPostingsFragments({ directory: shardsDir, fields, maxPartBytes, signal });
    const parts = written.parts.map(part => ({ ...part,
      path: path.posix.join(generation, 'field_postings.shards', part.filename), absPath: path.join(shardsDir, part.filename) }));
    setPhase?.('publish:field-postings-shard-merge');
    const metrics = {};
    const merged = await mergeFieldPostingsFragments({ root: outDir, parts, expectedTotalBytes: written.totalBytes,
      targetPath: legacyPath, signal, metrics });
    const meta = await writeJsonObjectFile(metaPath, { fields: {
      schemaVersion: '2.0.0', layout: FIELD_POSTINGS_FRAGMENT_LAYOUT,
      generatedAt: new Date().toISOString(), shardCount: parts.length, fields: Object.keys(fields).length,
      desiredShardCount, estimatedBytes, totalBytes: written.totalBytes, shardTargetBytes: maxPartBytes,
      parts: parts.map(({ filename: _filename, absPath: _absPath, ...part }) => part),
      merge: { strategy: 'ordered-byte-fragment-merge', outputPath: path.posix.join(generation, 'field_postings.json') }
    }, atomic: true, checksumAlgo: 'sha1', signal });
    // Register the entire family only after its complete payload and sidecars.
    // Failed staging can leave recoverable bytes, never replacement authority.
    for (const part of parts) addPieceFile({ type: 'postings', name: 'field_postings_shard', format: 'binary',
      bytes: part.bytes, checksum: `sha1:${part.checksum}` }, part.absPath);
    addPieceFile({ type: 'postings', name: 'field_postings_shards_meta', format: 'json',
      bytes: meta.bytes, checksum: `sha1:${meta.checksum}` }, metaPath);
    addPieceFile({ type: 'postings', name: 'field_postings', format: 'json',
      bytes: merged.bytes, checksum: `sha1:${merged.checksum}` }, legacyPath);
    const durationMs = performance.now() - started;
    return { ...merged, serializationMs: written.encodingTiming.computeMs || 0, durationMs,
      diskMs: Math.max(0, durationMs - (written.encodingTiming.computeMs || 0) - (written.encodingTiming.cooperativeWaitMs || 0)),
      phaseTimings: { computeMs: 0, serializationMs: written.encodingTiming.computeMs || 0, flushMs: 0,
        publishMs: 0, backpressureWaitMs: written.encodingTiming.writeWaitMs || 0 },
      fragmentCount: parts.length, maxPartBytes, mergeReadChunkBytesHighWater: metrics.readChunkBytesHighWater || 0 };
  }, { priority: 206, estimatedBytes: maxPartBytes, laneHint: 'massive' });
  return { generation, shardsDir, metaPath, legacyPath, maxPartBytes };
};
