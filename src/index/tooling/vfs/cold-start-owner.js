import { MinHeap } from '../../../shared/min-heap.js';
import { compareStrings } from '../../../shared/sort.js';

export const VFS_COLD_METADATA_MAX_BYTES = 8 * 1024 * 1024;
export const VFS_COLD_MAX_ENTRIES = 50000;
export const VFS_COLD_MAX_ROW_BYTES = 32 * 1024;

/** Payload and serialized-metadata accounting bound one live cache instance.
 * Count additionally bounds object/index overhead; no absolute V8 heap claim is
 * made. Heap tombstones are rebuilt at a bounded amortized threshold. */
export const createColdStartEntryOwner = ({ maxBytes, maxAgeMs = null, now = Date.now, onMutation = () => {},
  maxEntries = VFS_COLD_MAX_ENTRIES, maxMetadataBytes = VFS_COLD_METADATA_MAX_BYTES } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 1
    || maxEntries > VFS_COLD_MAX_ENTRIES || !Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes < 1
    || maxMetadataBytes > VFS_COLD_METADATA_MAX_BYTES || maxAgeMs !== null && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0)) {
    throw new RangeError('Invalid bounded VFS cold-cache owner policy.');
  }
  const entries = new Map();
  const compare = (left, right) => left.updatedAtMs - right.updatedAtMs
    || (left.ordinal < right.ordinal ? -1 : left.ordinal > right.ordinal ? 1 : 0)
    || compareStrings(left.entry.virtualPath, right.entry.virtualPath);
  let heap = new MinHeap(compare), payloadBytes = 0n, metadataBytes = 0;
  let ordinal = 0n;
  const counters = { admissions: 0, updates: 0, evictions: 0, expired: 0, oversized: 0, disabled: 0, heapRebuilds: 0 };
  const drop = (record, reason) => {
    if (entries.get(record.entry.virtualPath) !== record) return;
    entries.delete(record.entry.virtualPath); payloadBytes -= BigInt(record.entry.sizeBytes); metadataBytes -= record.metadataBytes;
    if (reason) counters[reason]++; onMutation();
  };
  const trim = () => {
    while (heap.size && entries.get(heap.items[0].entry.virtualPath) !== heap.items[0]) heap.pop();
    if (heap.size > entries.size * 2 + 128) {
      heap = new MinHeap(compare); for (const record of entries.values()) heap.push(record); counters.heapRebuilds++;
    }
  };
  const expire = () => {
    trim(); if (!(maxAgeMs > 0)) return;
    const cutoff = now() - maxAgeMs;
    while (heap.size && heap.items[0].updatedAtMs < cutoff) { drop(heap.pop(), 'expired'); trim(); }
  };
  const admit = entry => {
    expire();
    if (!maxBytes) { counters.disabled++; return false; }
    const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
    if (entry.sizeBytes > maxBytes || bytes > VFS_COLD_MAX_ROW_BYTES || bytes > maxMetadataBytes) { counters.oversized++; return false; }
    const record = Object.freeze({ entry, metadataBytes: bytes, updatedAtMs: Date.parse(entry.updatedAt), ordinal: ++ordinal });
    if (maxAgeMs > 0 && record.updatedAtMs < now() - maxAgeMs) { counters.expired++; return false; }
    const prior = entries.get(entry.virtualPath);
    if (prior) { drop(prior); counters.updates++; }
    entries.set(entry.virtualPath, record); payloadBytes += BigInt(entry.sizeBytes); metadataBytes += bytes;
    heap.push(record); counters.admissions++; onMutation();
    while (payloadBytes > BigInt(maxBytes) || metadataBytes > maxMetadataBytes || entries.size > maxEntries) {
      trim(); drop(heap.pop(), 'evictions');
    }
    trim(); return entries.get(entry.virtualPath) === record;
  };
  return {
    admit,
    get(key) { expire(); return entries.get(key)?.entry || null; },
    clear() { entries.clear(); heap = new MinHeap(compare); payloadBytes = 0n; metadataBytes = 0; onMutation(); },
    size() { expire(); return entries.size; },
    snapshot() { expire(); return { entries: [...entries.values()].sort(compare).map(record => record.entry), payloadBytes: Number(payloadBytes), metadataBytes }; },
    stats() { expire(); return { ...counters, entries: entries.size, payloadBytes: Number(payloadBytes), metadataBytes, heapEntries: heap.size,
      maxBytes, maxEntries, maxMetadataBytes, maxRowBytes: VFS_COLD_MAX_ROW_BYTES, maxAgeMs }; }
  };
};
