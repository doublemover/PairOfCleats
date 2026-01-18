import { TextEncoder } from 'node:util';

const encoder = new TextEncoder();

const compareBytes = (query, bytes, start, end) => {
  const entryLen = end - start;
  const minLen = Math.min(query.length, entryLen);
  for (let i = 0; i < minLen; i += 1) {
    const diff = query[i] - bytes[start + i];
    if (diff < 0) return -1;
    if (diff > 0) return 1;
  }
  if (query.length === entryLen) return 0;
  return query.length < entryLen ? -1 : 1;
};

const compareEntry = (a, b) => {
  const minLen = Math.min(a.bytes.length, b.bytes.length);
  for (let i = 0; i < minLen; i += 1) {
    const diff = a.bytes[i] - b.bytes[i];
    if (diff < 0) return -1;
    if (diff > 0) return 1;
  }
  if (a.bytes.length === b.bytes.length) return 0;
  return a.bytes.length < b.bytes.length ? -1 : 1;
};

const normalizeWord = (word) => (typeof word === 'string' ? word : '');

export const createSharedDictionary = (words) => {
  const list = Array.isArray(words) ? words : Array.from(words || []);
  const entries = [];
  let maxLen = 0;
  for (const word of list) {
    const normalized = normalizeWord(word);
    if (!normalized) continue;
    if (normalized.length > maxLen) maxLen = normalized.length;
    entries.push({ word: normalized, bytes: encoder.encode(normalized) });
  }
  if (!entries.length) return null;
  entries.sort(compareEntry);
  let totalBytes = 0;
  for (const entry of entries) totalBytes += entry.bytes.length;
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  if (totalBytes > 0xffffffff) return null;

  const bytesBuffer = new SharedArrayBuffer(totalBytes);
  const bytesView = new Uint8Array(bytesBuffer);
  const offsetsBuffer = new SharedArrayBuffer((entries.length + 1) * Uint32Array.BYTES_PER_ELEMENT);
  const offsetsView = new Uint32Array(offsetsBuffer);

  let offset = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    offsetsView[i] = offset;
    bytesView.set(entry.bytes, offset);
    offset += entry.bytes.length;
  }
  offsetsView[entries.length] = offset;

  return {
    bytes: bytesBuffer,
    offsets: offsetsBuffer,
    count: entries.length,
    maxLen
  };
};

export const createSharedDictionaryView = (payload) => {
  if (!payload?.bytes || !payload?.offsets) return null;
  const bytes = new Uint8Array(payload.bytes);
  const offsets = new Uint32Array(payload.offsets);
  const countRaw = Number.isFinite(payload.count) ? payload.count : Math.max(0, offsets.length - 1);
  const count = Math.max(0, Math.min(countRaw, offsets.length - 1));
  const maxLen = Number.isFinite(payload.maxLen) ? payload.maxLen : 0;
  const has = (value) => {
    if (typeof value !== 'string' || !value) return false;
    if (maxLen && value.length > maxLen) return false;
    const query = encoder.encode(value);
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = offsets[mid];
      const end = offsets[mid + 1];
      const cmp = compareBytes(query, bytes, start, end);
      if (cmp === 0) return true;
      if (cmp < 0) high = mid - 1;
      else low = mid + 1;
    }
    return false;
  };
  return {
    size: count,
    has,
    __sharedDict: true,
    __maxTokenLength: maxLen
  };
};
