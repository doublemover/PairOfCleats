import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteText } from '../../../../src/shared/io/atomic-write.js';
import { assertNoSymlinkPath, openContainedFile, verifyContainedFileHandle } from '../../../../src/shared/contained-file.js';
import { createCacheIndex, normalizeCacheIndex } from './index-state.js';

const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const MIN_CHECKPOINT_BYTES = 256 * 1024;
const records = new Map(), leases = new WeakMap(), reads = new Map();
const metrics = { checkpointReads: 0, checkpointBytes: 0, checkpointSerializations: 0, deltaSerializations: 0, encodedBytes: 0, journalReadBytes: 0 };
const paths = directory => ({ canonical: path.join(directory, 'cache.index.json'), legacy: path.join(directory, 'cache.index.bin'), log: path.join(directory, 'cache.index.delta') });
const failure = message => Object.assign(new Error(message), { code: 'ERR_EMBEDDING_CACHE_INDEX_LOG' });
const stamp = stat => stat ? [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':') : null;
const statFile = async filename => { try { return await fs.stat(filename, { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const logIdentity = stat => stat ? `${stat.dev}:${stat.ino}` : null;
const remember = (key, record) => {
  records.delete(key);
  if (record.checkpointBytes + record.offset <= MAX_INDEX_BYTES && !record.partial) records.set(key, record);
  let bytes = [...records.values()].reduce((sum, value) => sum + value.checkpointBytes + value.offset, 0);
  while (records.size > 8 || bytes > MAX_INDEX_BYTES) {
    const first = records.keys().next().value, previous = records.get(first);
    records.delete(first); bytes -= previous.checkpointBytes + previous.offset;
  }
};
const readExact = async (handle, size, position) => {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, position + offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  metrics.journalReadBytes += offset;
  return offset === size ? buffer : null;
};
const apply = (index, delta) => {
  if (delta.version !== 1 || delta.identityKey !== index.identityKey || !Number.isSafeInteger(delta.sequence)
    || !Number.isSafeInteger(delta.storageEpoch) || delta.storageEpoch < 0) throw failure('Invalid embedding index delta identity.');
  if (delta.generation !== index.journal?.generation) return;
  if (delta.sequence <= index.journal.sequence) return;
  if (delta.sequence !== index.journal.sequence + 1 || delta.storageEpoch < (index.storageEpoch || 0)) throw failure('Embedding index delta sequence/epoch discontinuity.');
  for (const [key, value] of Object.entries(delta.entries || {})) {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(key) || value?.key !== key || (value.storageEpoch || 0) < (index.storageEpoch || 0)) throw failure('Invalid or stale embedding index pointer.');
    index.entries[key] = value;
  }
  for (const [name, value] of Object.entries(delta.shards || {})) {
    if (!/^shard-\d{5,}\.bin$/.test(name)) throw failure('Invalid embedding index shard.');
    index.shards[name] = value;
  }
  for (const [file, key] of Object.entries(delta.files || {})) {
    if (key == null) delete index.files[file]; else index.files[file] = key;
  }
  index.chunkInputs ||= Object.create(null);
  for (const [input, key] of Object.entries(delta.chunkInputs || {})) {
    if (key == null) delete index.chunkInputs[input]; else index.chunkInputs[input] = key;
  }
  for (const field of ['storageEpoch', 'nextShardId', 'currentShard', 'updatedAt']) index[field] = delta[field];
  index.journal.sequence = delta.sequence;
};

const replay = async (directory, record, logStat) => {
  if (!logStat) { record.offset = 0; record.logIdentity = null; record.logStamp = null; return; }
  if (Number(logStat.size) > MAX_INDEX_BYTES) throw failure('Embedding index delta log exceeds its bounded replay limit.');
  const filename = paths(directory).log;
  const handle = await openContainedFile(directory, filename);
  try {
    const size = Number(logStat.size);
    while (record.offset < size) {
      const prefix = size - record.offset >= 4 ? await readExact(handle, 4, record.offset) : null;
      if (!prefix) { record.partial = true; break; }
      const bytes = prefix.readUInt32LE(0);
      if (!bytes || bytes > MAX_FRAME_BYTES) throw failure('Invalid embedding index delta frame size.');
      if (size - record.offset < 4 + bytes + 32) { record.partial = true; break; }
      const frame = await readExact(handle, bytes + 32, record.offset + 4);
      if (!frame) { record.partial = true; break; }
      const payload = frame.subarray(0, bytes), digest = createHash('sha256').update(payload).digest();
      if (!digest.equals(frame.subarray(bytes))) throw failure('Embedding index delta checksum mismatch.');
      let delta;
      try { delta = JSON.parse(payload.toString('utf8')); } catch { throw failure('Embedding index delta JSON is corrupt.'); }
      apply(record.index, delta);
      record.offset += 4 + bytes + 32;
    }
    verifyContainedFileHandle(handle, directory, filename);
    record.logIdentity = logIdentity(logStat); record.logStamp = stamp(logStat);
  } finally { await handle.close(); }
};

const load = async (directory, identityKey) => {
  const key = JSON.stringify([path.resolve(directory), identityKey]), filenames = paths(directory);
  const canonicalStat = await statFile(filenames.canonical), legacyStat = canonicalStat ? null : await statFile(filenames.legacy);
  const source = canonicalStat ? filenames.canonical : legacyStat ? filenames.legacy : null;
  const checkpointStat = canonicalStat || legacyStat, checkpointStamp = `${source}:${stamp(checkpointStat)}`;
  const logStat = await statFile(filenames.log);
  let record = records.get(key);
  if (record && (record.checkpointStamp !== checkpointStamp || record.logIdentity !== logIdentity(logStat)
    || Number(logStat?.size || 0) < record.offset || (Number(logStat?.size || 0) === record.offset && record.logStamp !== stamp(logStat)))) record = null;
  if (!record) {
    let index = createCacheIndex(identityKey), checkpointBytes = 0;
    if (source) {
      checkpointBytes = Number(checkpointStat.size);
      if (checkpointBytes > MAX_INDEX_BYTES) throw failure('Embedding index checkpoint exceeds its read budget.');
      const handle = await openContainedFile(directory, source);
      try {
        const raw = await handle.readFile('utf8'); metrics.checkpointReads++; metrics.checkpointBytes += Buffer.byteLength(raw);
        const parsed = JSON.parse(raw);
        if (parsed.version !== 1 || identityKey && parsed.identityKey && parsed.identityKey !== identityKey) throw failure('Embedding cache checkpoint identity/version mismatch.');
        index = normalizeCacheIndex(parsed, identityKey);
        if (index.journal && (index.journal.version !== 1 || typeof index.journal.generation !== 'string' || !index.journal.generation
          || !Number.isSafeInteger(index.journal.sequence) || index.journal.sequence < 0)) throw failure('Invalid embedding index checkpoint log identity.');
        verifyContainedFileHandle(handle, directory, source);
      } finally { await handle.close(); }
    }
    record = { index, checkpointStamp, checkpointBytes, offset: 0, logStamp: null, logIdentity: null, partial: false };
  }
  if (logStat && !record.index.journal) throw failure('Embedding index log has no authoritative checkpoint generation.');
  await replay(directory, record, logStat);
  const afterCanonical = await statFile(filenames.canonical), afterLegacy = afterCanonical ? null : await statFile(filenames.legacy);
  if (`${afterCanonical ? filenames.canonical : afterLegacy ? filenames.legacy : null}:${stamp(afterCanonical || afterLegacy)}` !== checkpointStamp) throw failure('Embedding index checkpoint changed during replay.');
  remember(key, record); leases.set(record.index, { key, record });
  return record;
};

/** Public readers receive independent mutable metadata, never the writer memo. */
export const readEmbeddingIndex = async (directory, identityKey, { strict = false, forUpdate = false } = {}) => {
  if (!directory) return createCacheIndex(identityKey);
  const key = JSON.stringify([path.resolve(directory), identityKey]);
  const prior = reads.get(key) || Promise.resolve();
  const operation = prior.catch(() => {}).then(async () => {
    const record = await load(directory, identityKey);
    if (record.partial && strict) throw failure('Embedding index has an uncommitted partial tail.');
    if (forUpdate) { records.delete(key); return record.index; }
    const copy = normalizeCacheIndex(structuredClone(record.index), identityKey);
    copy.chunkInputs = Object.assign(Object.create(null), copy.chunkInputs || {});
    return copy;
  });
  reads.set(key, operation);
  try {
    return await operation;
  } catch (error) {
    records.delete(key);
    if (strict || forUpdate) throw error;
    return createCacheIndex(identityKey);
  } finally { if (reads.get(key) === operation) reads.delete(key); }
};

/** Explicit checkpoint caller holds the existing cache lock. Bin is compatibility
 * output; canonical JSON publication is authority and consumes one encoding. */
export const checkpointEmbeddingIndex = async (directory, index) => {
  const filenames = paths(directory);
  await fs.mkdir(directory, { recursive: true });
  for (const filename of Object.values(filenames)) assertNoSymlinkPath(directory, filename, { allowMissing: true });
  index.journal = index.journal?.version === 1 ? { ...index.journal } : { version: 1, generation: randomUUID(), sequence: 0 };
  const payload = JSON.stringify(index); metrics.checkpointSerializations++; metrics.encodedBytes += Buffer.byteLength(payload);
  if (Buffer.byteLength(payload) > MAX_INDEX_BYTES) throw failure('Embedding checkpoint exceeds the admitted metadata budget.');
  const key = JSON.stringify([path.resolve(directory), index.identityKey]); records.delete(key);
  await atomicWriteText(filenames.legacy, payload);
  await atomicWriteText(filenames.canonical, payload);
  // Windows append-only handles cannot truncate a retired journal. The cache
  // writer lock already owns ordering; use read/write access and explicit offsets.
  const handle = await fs.open(filenames.log, fsConstants.O_RDWR | fsConstants.O_CREAT);
  try { verifyContainedFileHandle(handle, directory, filenames.log); await handle.truncate(0); await handle.sync(); }
  finally { await handle.close(); }
};

/** Publish only changed pointers/aliases after their shard bytes are synced. */
export const appendEmbeddingIndexDelta = async (directory, index, { keys = [], fileKeys = [], inputKeys = [] } = {}) => {
  if (!index.journal) { await checkpointEmbeddingIndex(directory, index); return; }
  const lease = leases.get(index), record = lease?.record;
  if (!record) throw failure('Embedding delta mutation requires the canonical locked writer lease.');
  if (!keys.length && !fileKeys.length && !inputKeys.length && !record.partial) { remember(lease.key, record); return; }
  const filenames = paths(directory), changed = [...new Set(keys)], touchedShards = new Set();
  for (const key of changed) if (index.entries[key]?.shard) touchedShards.add(index.entries[key].shard);
  const delta = { version: 1, identityKey: index.identityKey, generation: index.journal.generation, sequence: index.journal.sequence + 1,
    storageEpoch: index.storageEpoch || 0, nextShardId: index.nextShardId, currentShard: index.currentShard, updatedAt: index.updatedAt,
    entries: Object.fromEntries(changed.map(key => [key, index.entries[key]])),
    shards: Object.fromEntries([...touchedShards].map(name => [name, index.shards[name]])),
    files: Object.fromEntries([...new Set(fileKeys)].map(file => [file, index.files[file] ?? null])),
    chunkInputs: Object.fromEntries([...new Set(inputKeys)].map(input => [input, index.chunkInputs?.[input] ?? null])) };
  const payload = Buffer.from(JSON.stringify(delta)); metrics.deltaSerializations++; metrics.encodedBytes += payload.length;
  if (payload.length > MAX_FRAME_BYTES || record.offset + payload.length + 36 > MAX_INDEX_BYTES) { await checkpointEmbeddingIndex(directory, index); return; }
  assertNoSymlinkPath(directory, filenames.log, { allowMissing: true });
  const handle = await fs.open(filenames.log, fsConstants.O_RDWR | fsConstants.O_CREAT);
  try {
    verifyContainedFileHandle(handle, directory, filenames.log);
    if (record.partial) await handle.truncate(record.offset);
    const prefix = Buffer.alloc(4); prefix.writeUInt32LE(payload.length);
    const frame = Buffer.concat([prefix, payload, createHash('sha256').update(payload).digest()]);
    let offset = 0;
    while (offset < frame.length) {
      const part = await handle.write(frame, offset, frame.length - offset, record.offset + offset);
      if (!part.bytesWritten) throw failure('Embedding index delta append made no progress.');
      offset += part.bytesWritten;
    }
    await handle.sync(); verifyContainedFileHandle(handle, directory, filenames.log);
    index.journal.sequence = delta.sequence;
    record.offset += frame.length; record.partial = false;
    const stat = await handle.stat({ bigint: true }); record.logIdentity = logIdentity(stat); record.logStamp = stamp(stat);
    if (record.offset >= Math.max(MIN_CHECKPOINT_BYTES, record.checkpointBytes)) await checkpointEmbeddingIndex(directory, index);
    else remember(lease.key, record);
  } finally { await handle.close(); }
};

/** Copy only affected metadata into a caller's independent lookup inventory. */
export const syncEmbeddingIndexDelta = (target, source, { keys = [], fileKeys = [], inputKeys = [] } = {}) => {
  for (const field of ['storageEpoch', 'nextShardId', 'currentShard', 'updatedAt', 'journal']) target[field] = structuredClone(source[field]);
  for (const key of keys) {
    if (!source.entries[key]) continue;
    target.entries[key] = structuredClone(source.entries[key]);
    const shard = source.entries[key].shard;
    if (shard) target.shards[shard] = { ...source.shards[shard] };
  }
  for (const file of fileKeys) { if (source.files[file]) target.files[file] = source.files[file]; else delete target.files[file]; }
  target.chunkInputs ||= Object.create(null);
  for (const input of inputKeys) { if (source.chunkInputs?.[input]) target.chunkInputs[input] = source.chunkInputs[input]; else delete target.chunkInputs[input]; }
};

export const getEmbeddingIndexLogMetrics = () => ({ ...metrics });
