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

export const FIELD_POSTINGS_FRAGMENT_LAYOUT = 'json-byte-fragments-v1';

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
    stream.destroy(error); await done.catch(() => {});
    if (current) {
      current.stream.destroy(error); await current.done.catch(() => {});
    }
    throw error;
  }
};

export const mergeFieldPostingsFragments = async ({ root, parts, targetPath, signal = null, metrics = {} }) => {
  const output = createJsonWriteStream(targetPath, { atomic: true, checksumAlgo: 'sha1', signal });
  let offset = 0;
  try {
    for (const part of parts) {
      throwIfAborted(signal);
      if (part.offset !== offset || !Number.isSafeInteger(part.bytes) || part.bytes <= 0) {
        throw Object.assign(new Error('Field-postings fragment sequence is not contiguous.'), { code: 'ERR_FIELD_POSTINGS_SHARD_INTEGRITY' });
      }
      await streamFieldPostingsShardBody({ root, filename: part.absPath || path.join(root, part.path || part.filename),
        expected: part, signal, metrics, fragment: true, onChunk: bytes => writeChunk(output.stream, bytes) });
      offset += part.bytes;
    }
    output.stream.end(); await output.done;
    return { bytes: output.getBytesWritten(), checksum: output.getChecksum(), checksumAlgo: output.checksumAlgo,
      serializationMs: 0, directFdStreaming: true };
  } catch (error) {
    output.stream.destroy(error); await output.done.catch(() => {}); throw error;
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
    const merged = await mergeFieldPostingsFragments({ root: outDir, parts, targetPath: legacyPath, signal, metrics });
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
