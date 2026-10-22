import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../../../../src/shared/contained-file.js';
const CHANNELS = ['code', 'doc', 'merged'];
export const digestQuantizedChannels = vectors => {
  const hash = createHash('sha256');
  for (const channel of CHANNELS) {
    const vector = vectors[channel] || [];
    hash.update(`${channel}:${vector.length}:`);
    for (const value of vector) if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid quantized cache vector.');
    hash.update(ArrayBuffer.isView(vector) && vector.BYTES_PER_ELEMENT === 1
      ? Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength) : Buffer.from(vector));
  }
  return hash.digest('hex');
};

/** Ordered file metadata references immutable, identity/input/content-qualified chunks. */
export const buildReferencedFileCache = ({ filePayload, chunkHashes, codeVectors, docVectors, mergedVectors,
  identityKey, identity, buildInputKey }) => {
  if (!Array.isArray(chunkHashes) || !chunkHashes.length || chunkHashes.length > 32768) return null;
  const chunks = new Map(), records = [];
  for (let index = 0; index < chunkHashes.length; index++) {
    const chunkHash = chunkHashes[index]; if (typeof chunkHash !== 'string' || !chunkHash) return null;
    const vectors = { code: codeVectors[index] || [], doc: docVectors[index] || [], merged: mergedVectors[index] || [] };
    const digest = digestQuantizedChannels(vectors), inputKey = buildInputKey(chunkHash);
    if (!inputKey) return null;
    const cacheKey = `${inputKey}-${digest}`;
    records.push({ key: cacheKey, hash: chunkHash, digest,
      channels: Object.fromEntries(CHANNELS.map(channel => [channel, vectors[channel].length])) });
    if (!chunks.has(cacheKey)) chunks.set(cacheKey, { cacheKey, inputKey, digest, vectors, payload: {
      key: cacheKey, hash: chunkHash, cacheMeta: { schemaVersion: 2, scope: 'global-chunk', inputKey, identityKey, identity: { dims: identity?.dims ?? null } },
      codeVectors: [vectors.code], docVectors: [vectors.doc], mergedVectors: [vectors.merged] } });
  }
  return { chunks: [...chunks.values()], filePayload: filePayload ? { ...filePayload, chunkCount: records.length,
    cacheMeta: { ...filePayload.cacheMeta, schemaVersion: 2, representation: 'chunk-references-v1' },
    chunkReferences: { schemaVersion: 1, identityKey, records }, codeVectors: [], docVectors: [], mergedVectors: [] } : null };
};

/** A missing/corrupt referenced chunk is a repairable cache miss, never an empty vector claim. */
export const hydrateReferencedFileCache = async ({ entry, identityKey, readChunks, maxBytes = 64 * 1024 * 1024 }) => {
  if (!entry?.chunkReferences) return entry;
  const references = entry.chunkReferences;
  if (references.schemaVersion !== 1 || references.identityKey !== identityKey || entry.cacheMeta?.identityKey !== identityKey
    || !Array.isArray(references.records) || references.records.length > 32768
    || references.records.length !== entry.chunkHashes?.length) return null;
  const unique = new Map(); let bytes = 0;
  for (let index = 0; index < references.records.length; index++) {
    const ref = references.records[index];
    if (!ref || ref.hash !== entry.chunkHashes[index] || typeof ref.key !== 'string' || !/^[a-f0-9]{64}$/.test(ref.digest || '')) return null;
    for (const channel of CHANNELS) {
      const length = ref.channels?.[channel];
      if (!Number.isSafeInteger(length) || length < 0) return null;
      bytes += length;
    }
    if (bytes > maxBytes) return null;
    unique.set(ref.key, ref);
  }
  const retained = new Map(), keys = [...unique.keys()];
  for (let offset = 0; offset < keys.length; offset += 64) {
    const batch = keys.slice(offset, offset + 64), results = await readChunks(batch);
    for (let index = 0; index < batch.length; index++) {
      const ref = unique.get(batch[index]), payload = results[index]?.entry;
      if (payload?.key !== ref.key || payload.hash !== ref.hash || payload.cacheMeta?.identityKey !== identityKey) return null;
      const vectors = { code: payload.codeVectors?.[0] || [], doc: payload.docVectors?.[0] || [], merged: payload.mergedVectors?.[0] || [] };
      let digest; try { digest = digestQuantizedChannels(vectors); } catch { return null; }
      if (CHANNELS.some(channel => vectors[channel].length !== ref.channels[channel]) || digest !== ref.digest) return null;
      retained.set(ref.key, vectors);
    }
  }
  return { ...entry, ...Object.fromEntries(CHANNELS.map(channel => [`${channel}Vectors`,
    references.records.map(ref => retained.get(ref.key)[channel])])) };
};

const MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);
const fileDirectory = (globalDir, mode) => {
  if (!MODES.has(mode)) throw new Error('Unrecognized embedding cache mode.');
  return path.join(path.dirname(globalDir), mode, 'files');
};

/** Compose the existing shard/index locks. Chunk publication precedes the file
 * index, whose projected references are retention authority. A failed file publication leaves reclaimable
 * unreferenced chunks, never a successfully published dangling reference.
 */
export const createReferenceCacheWriter = ({ lock, readIndex, writeIndex, publishDelta = writeIndex, syncIndex = null, readEntries, append, upsert, writeFiles }) =>
  async ({ globalDir, globalIndex, fileDir, fileIndex, filePayload, encodedFile, chunks, mode, options = {} }) => {
    if (filePayload && path.resolve(fileDir) !== path.resolve(fileDirectory(globalDir, mode))) throw new Error('File reference escaped its profile.');
    if (chunks.some(chunk => chunk.payload.cacheMeta?.identityKey !== globalIndex.identityKey)
      || filePayload && (filePayload.cacheMeta?.identityKey !== globalIndex.identityKey || fileIndex?.identityKey !== globalIndex.identityKey
        || filePayload.chunkReferences?.identityKey !== globalIndex.identityKey)) throw new Error('Embedding reference identity mismatch.');
    return lock(globalDir, async () => {
      const canonical = await readIndex(globalDir, globalIndex.identityKey);
      canonical.chunkInputs ||= Object.create(null);
      let storedChunks = 0;
      const changedKeys = [], changedInputs = [];
      const existing = await readEntries(globalDir, chunks.map(chunk => chunk.cacheKey), canonical);
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index], old = existing[index]?.entry;
        let valid = old?.key === chunk.cacheKey && old.hash === chunk.payload.hash && old.cacheMeta?.identityKey === canonical.identityKey;
        if (valid) {
          try { valid = digestQuantizedChannels({ code: old.codeVectors?.[0], doc: old.docVectors?.[0], merged: old.mergedVectors?.[0] }) === chunk.digest; }
          catch { valid = false; }
        }
        if (!valid) {
          const pointer = await append(globalDir, canonical, chunk.encodedPayload, options);
          upsert(canonical, chunk.cacheKey, chunk.payload, pointer);
          changedKeys.push(chunk.cacheKey);
          storedChunks++;
        }
        if (canonical.chunkInputs[chunk.inputKey] !== chunk.cacheKey) changedInputs.push(chunk.inputKey);
        canonical.chunkInputs[chunk.inputKey] = chunk.cacheKey;
      }
      if (filePayload) {
        const keys = [...new Set(filePayload.chunkReferences.records.map(record => record.key))];
        if (keys.some(key => !canonical.entries[key])) throw new Error('File cache references unpublished chunk content.');
      }
      await publishDelta(globalDir, canonical, { keys: changedKeys, inputKeys: changedInputs });
      if (syncIndex) syncIndex(globalIndex, canonical, { keys: chunks.map(chunk => chunk.cacheKey), inputKeys: chunks.map(chunk => chunk.inputKey) });
      else { for (const key of Object.keys(globalIndex)) delete globalIndex[key]; Object.assign(globalIndex, canonical); }
      if (filePayload) {
        const written = await writeFiles(fileDir, fileIndex, [{ cacheKey: filePayload.key, payload: filePayload, encodedPayload: encodedFile }], options);
        if (!written) throw new Error('File cache index publication did not acquire its lock.');
      }
      return { storedChunks, referencedChunks: chunks.length, filePublished: Boolean(filePayload) };
    }, options.lock);
  };

/** Known profile file indexes are reachability authority; unreadable ownership
 * blocks pruning, while a missing/retired file key releases its chunk pins.
 */
export const collectReferenceProtection = async (globalDir, index, { readIndex = null } = {}) => {
  const protectedKeys = new Set();
  if (path.basename(globalDir) !== 'global-chunks') return { incomplete: false, protectedKeys, changed: false };
  for (const mode of MODES) {
      try {
        const filename = path.join(fileDirectory(globalDir, mode), 'cache.index.json');
        let observed = filename;
        assertNoSymlinkPath(path.dirname(globalDir), observed, { allowMissing: true });
        let stat;
        try { stat = await fs.lstat(observed); }
        catch (error) {
          if (error.code !== 'ENOENT' || !readIndex) throw error;
          observed = path.join(path.dirname(filename), 'cache.index.bin');
          assertNoSymlinkPath(path.dirname(globalDir), observed, { allowMissing: true });
          try { stat = await fs.lstat(observed); }
          catch (legacyError) {
            if (legacyError.code !== 'ENOENT') throw legacyError;
            // A log without either checkpoint is not a retired/missing owner.
            const log = await fs.lstat(path.join(path.dirname(filename), 'cache.index.delta')).catch(logError => {
              if (logError.code === 'ENOENT') return null; throw logError;
            });
            if (log?.size) return { incomplete: true, protectedKeys };
            continue;
          }
        }
        if (stat.isSymbolicLink() || !stat.isFile()) return { incomplete: true, protectedKeys };
        const value = readIndex ? await readIndex(path.dirname(filename), index.identityKey, { strict: true })
          : JSON.parse(await fs.readFile(filename, 'utf8'));
        if (value.version !== 1 || !value.entries || typeof value.entries !== 'object') return { incomplete: true, protectedKeys };
        for (const entry of Object.values(value.entries)) {
          const reference = entry.chunkReferences; if (!reference) continue;
          if (value.identityKey !== index.identityKey || reference.identityKey !== index.identityKey || reference.schemaVersion !== 1
            || !Array.isArray(reference.keys) || reference.keys.length > 32768
            || reference.keys.some(key => typeof key !== 'string' || !index.entries?.[key])) return { incomplete: true, protectedKeys };
          for (const key of reference.keys) protectedKeys.add(key);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') return { incomplete: true, protectedKeys };
      }
  }
  return { incomplete: false, protectedKeys, changed: false };
};
