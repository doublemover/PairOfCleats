import { writeChunk } from './streams.js';
import { throwIfAborted } from './runtime.js';

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

export const writeJsonValue = async (stream, value) => {
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
    await writeChunk(stream, '[');
    let first = true;
    for (let i = 0; i < normalized.length; i += 1) {
      if (!first) await writeChunk(stream, ',');
      await writeChunk(stream, JSON.stringify(normalized[i]));
      first = false;
    }
    await writeChunk(stream, ']');
    return;
  }
  if (Array.isArray(normalized)) {
    await writeChunk(stream, '[');
    let first = true;
    for (const item of normalized) {
      if (!first) await writeChunk(stream, ',');
      const itemValue = normalizeJsonValue(item);
      if (itemValue === undefined || typeof itemValue === 'function' || typeof itemValue === 'symbol') {
        await writeChunk(stream, 'null');
      } else {
        await writeJsonValue(stream, itemValue);
      }
      first = false;
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
    await writeJsonValue(stream, entryValue);
    first = false;
  }
  await writeChunk(stream, '}');
};

export const stringifyJsonValue = (value) => {
  const normalized = normalizeJsonValue(value);
  if (normalized === null || typeof normalized !== 'object') {
    if (normalized === undefined || typeof normalized === 'function' || typeof normalized === 'symbol') {
      return 'null';
    }
    return JSON.stringify(normalized);
  }
  if (ArrayBuffer.isView(normalized) && !(normalized instanceof DataView)) {
    const items = [];
    for (let i = 0; i < normalized.length; i += 1) {
      items.push(JSON.stringify(normalized[i]));
    }
    return `[${items.join(',')}]`;
  }
  if (Array.isArray(normalized)) {
    const items = normalized.map((item) => stringifyJsonValue(item));
    return `[${items.join(',')}]`;
  }
  const entries = [];
  for (const [key, entry] of Object.entries(normalized)) {
    const entryValue = normalizeJsonValue(entry);
    if (entryValue === undefined || typeof entryValue === 'function' || typeof entryValue === 'symbol') {
      continue;
    }
    entries.push(`${JSON.stringify(key)}:${stringifyJsonValue(entryValue)}`);
  }
  return `{${entries.join(',')}}`;
};

export const writeArrayItems = async (stream, items, signal = null) => {
  let first = true;
  for (const item of items) {
    throwIfAborted(signal);
    if (!first) await writeChunk(stream, ',');
    await writeJsonValue(stream, item);
    first = false;
  }
};
