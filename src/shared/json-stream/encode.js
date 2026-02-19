import { writeChunk } from './streams.js';
import { createCooperativeYielder, throwIfAborted } from './runtime.js';

export const normalizeJsonValue = (value) => {
  if (value && typeof value === 'object') {
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      return value;
    }
    if (typeof value.toJSON === 'function') {
      try {
        return value.toJSON();
      } catch {
        return value;
      }
    }
  }
  return value;
};

const trackJsonTraversal = (value, seen) => {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) {
    throw new TypeError('[json-stream] Circular JSON value.');
  }
  seen.add(value);
  return true;
};

const untrackJsonTraversal = (value, seen, tracked) => {
  if (tracked && value && typeof value === 'object') {
    seen.delete(value);
  }
};

const TYPED_ARRAY_JSON_BATCH = 2048;
const PRIMITIVE_ARRAY_JSON_BATCH = 2048;

const serializeTypedArraySlice = (array, start, end) => {
  const size = end - start;
  if (size <= 0) return '';
  const parts = new Array(size);
  for (let i = 0; i < size; i += 1) {
    parts[i] = JSON.stringify(array[start + i]);
  }
  return parts.join(',');
};

const writeTypedArrayJson = async (stream, array, cooperate = null) => {
  await writeChunk(stream, '[');
  if (!array.length) {
    await writeChunk(stream, ']');
    return;
  }
  let first = true;
  for (let i = 0; i < array.length; i += TYPED_ARRAY_JSON_BATCH) {
    if (cooperate) await cooperate();
    const end = Math.min(array.length, i + TYPED_ARRAY_JSON_BATCH);
    const chunk = serializeTypedArraySlice(array, i, end);
    if (chunk.length) {
      await writeChunk(stream, first ? chunk : `,${chunk}`);
      first = false;
    }
  }
  await writeChunk(stream, ']');
};

const stringifyTypedArrayJson = (array) => {
  if (!array.length) return '[]';
  const parts = [];
  for (let i = 0; i < array.length; i += TYPED_ARRAY_JSON_BATCH) {
    const end = Math.min(array.length, i + TYPED_ARRAY_JSON_BATCH);
    parts.push(serializeTypedArraySlice(array, i, end));
  }
  return `[${parts.join(',')}]`;
};

const isFastJsonPrimitive = (value) => (
  value === null
  || typeof value === 'string'
  || typeof value === 'number'
  || typeof value === 'boolean'
);

const writeJsonValueInternal = async (stream, value, seen, cooperate = null) => {
  const normalized = normalizeJsonValue(value);
  if (normalized === null || typeof normalized !== 'object') {
    if (normalized === undefined || typeof normalized === 'function' || typeof normalized === 'symbol') {
      await writeChunk(stream, 'null');
      return;
    }
    await writeChunk(stream, JSON.stringify(normalized));
    return;
  }
  if (ArrayBuffer.isView(normalized) && !(normalized instanceof DataView)) {
    await writeTypedArrayJson(stream, normalized, cooperate);
    return;
  }

  const tracked = trackJsonTraversal(normalized, seen);
  try {
    if (Array.isArray(normalized)) {
      await writeChunk(stream, '[');
      let first = true;
      let primitiveBatch = [];
      const flushPrimitiveBatch = async () => {
        if (!primitiveBatch.length) return;
        const chunk = primitiveBatch.join(',');
        await writeChunk(stream, first ? chunk : `,${chunk}`);
        primitiveBatch = [];
        first = false;
      };
      for (const item of normalized) {
        const itemValue = normalizeJsonValue(item);
        if (itemValue === undefined || typeof itemValue === 'function' || typeof itemValue === 'symbol') {
          primitiveBatch.push('null');
          if (primitiveBatch.length >= PRIMITIVE_ARRAY_JSON_BATCH) {
            await flushPrimitiveBatch();
            if (cooperate) await cooperate();
          }
          continue;
        }
        if (isFastJsonPrimitive(itemValue)) {
          primitiveBatch.push(JSON.stringify(itemValue));
          if (primitiveBatch.length >= PRIMITIVE_ARRAY_JSON_BATCH) {
            await flushPrimitiveBatch();
            if (cooperate) await cooperate();
          }
          continue;
        }
        await flushPrimitiveBatch();
        if (!first) await writeChunk(stream, ',');
        await writeJsonValueInternal(stream, itemValue, seen, cooperate);
        if (cooperate) await cooperate();
        first = false;
      }
      if (primitiveBatch.length) {
        await flushPrimitiveBatch();
      }
      await writeChunk(stream, ']');
      return;
    }
    await writeChunk(stream, '{');
    let first = true;
    for (const [key, entry] of Object.entries(normalized)) {
      const entryValue = normalizeJsonValue(entry);
      if (entryValue === undefined || typeof entryValue === 'function' || typeof entryValue === 'symbol') {
        continue;
      }
      if (!first) await writeChunk(stream, ',');
      await writeChunk(stream, `${JSON.stringify(key)}:`);
      await writeJsonValueInternal(stream, entryValue, seen, cooperate);
      if (cooperate) await cooperate();
      first = false;
    }
    await writeChunk(stream, '}');
  } finally {
    untrackJsonTraversal(normalized, seen, tracked);
  }
};

export const writeJsonValue = async (stream, value, options = {}) => {
  const cooperate = typeof options?.cooperate === 'function'
    ? options.cooperate
    : createCooperativeYielder();
  await writeJsonValueInternal(stream, value, new WeakSet(), cooperate);
};

const stringifyJsonValueInternal = (value, seen) => {
  const normalized = normalizeJsonValue(value);
  if (normalized === null || typeof normalized !== 'object') {
    if (normalized === undefined || typeof normalized === 'function' || typeof normalized === 'symbol') {
      return 'null';
    }
    return JSON.stringify(normalized);
  }
  if (ArrayBuffer.isView(normalized) && !(normalized instanceof DataView)) {
    return stringifyTypedArrayJson(normalized);
  }

  const tracked = trackJsonTraversal(normalized, seen);
  try {
    if (Array.isArray(normalized)) {
      const items = normalized.map((item) => stringifyJsonValueInternal(item, seen));
      return `[${items.join(',')}]`;
    }
    const entries = [];
    for (const [key, entry] of Object.entries(normalized)) {
      const entryValue = normalizeJsonValue(entry);
      if (entryValue === undefined || typeof entryValue === 'function' || typeof entryValue === 'symbol') {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${stringifyJsonValueInternal(entryValue, seen)}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    untrackJsonTraversal(normalized, seen, tracked);
  }
};

export const stringifyJsonValue = (value) => {
  return stringifyJsonValueInternal(value, new WeakSet());
};

export const writeArrayItems = async (stream, items, signal = null) => {
  const cooperate = createCooperativeYielder();
  let first = true;
  for (const item of items) {
    throwIfAborted(signal);
    if (!first) await writeChunk(stream, ',');
    await writeJsonValue(stream, item, { cooperate });
    await cooperate();
    first = false;
  }
};
