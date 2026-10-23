import { writeChunk, writeChunkIfNeeded } from './streams.js';
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
const JSON_STRING_BATCH_CHARS = 32 * 1024;

// Native escaping is context independent except for surrogate pairs. Keep a
// pair in the same slice so lone surrogates and astral text match one complete
// JSON.stringify call without constructing one complete escaped large string.
function* iterateJsonStringFragments(value) {
  yield '"';
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + JSON_STRING_BATCH_CHARS);
    const last = value.charCodeAt(end - 1), next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    yield JSON.stringify(value.slice(offset, end)).slice(1, -1);
    offset = end;
  }
  yield '"';
}

const serializeTypedArraySlice = (array, start, end) => {
  const size = end - start;
  if (size <= 0) return '';
  const parts = new Array(size);
  for (let i = 0; i < size; i += 1) {
    parts[i] = JSON.stringify(array[start + i]);
  }
  return parts.join(',');
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

/** Synchronous traversal suspends only at bounded output/yield boundaries. */
function* iterateJsonFragments(value, seen) {
  const stack = [{ kind: 'value', value }];
  while (stack.length) {
    const frame = stack.pop();
    if (frame.kind === 'end') {
      seen.delete(frame.value);
      yield frame.array ? ']' : '}';
      continue;
    }
    if (frame.kind === 'array') {
      if (frame.index >= frame.value.length) continue;
      const item = normalizeJsonValue(frame.value[frame.index]);
      stack.push({ ...frame, index: frame.index + 1 });
      stack.push({ kind: 'value', value: item });
      if (frame.index) yield ',';
      continue;
    }
    if (frame.kind === 'object') {
      let selected = false;
      while (frame.index < frame.entries.length) {
        const [key, rawEntry] = frame.entries[frame.index++];
        const entry = normalizeJsonValue(rawEntry);
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue;
        stack.push({ ...frame, first: false });
        stack.push({ kind: 'value', value: entry });
        if (key.length > JSON_STRING_BATCH_CHARS) {
          if (!frame.first) yield ',';
          yield* iterateJsonStringFragments(key);
          yield ':';
        } else yield `${frame.first ? '' : ','}${JSON.stringify(key)}:`;
        selected = true;
        break;
      }
      if (selected) continue;
      continue;
    }
    const normalized = normalizeJsonValue(frame.value);
    if (normalized === null || typeof normalized !== 'object') {
      if (typeof normalized === 'string' && normalized.length > JSON_STRING_BATCH_CHARS) {
        yield* iterateJsonStringFragments(normalized);
      } else {
        yield normalized === undefined || typeof normalized === 'function' || typeof normalized === 'symbol'
          ? 'null' : JSON.stringify(normalized);
      }
      continue;
    }
    if (ArrayBuffer.isView(normalized) && !(normalized instanceof DataView)) {
      yield '[';
      for (let index = 0; index < normalized.length; index += TYPED_ARRAY_JSON_BATCH) {
        yield `${index ? ',' : ''}${serializeTypedArraySlice(normalized, index, Math.min(normalized.length, index + TYPED_ARRAY_JSON_BATCH))}`;
      }
      yield ']';
      continue;
    }
    trackJsonTraversal(normalized, seen);
    const array = Array.isArray(normalized);
    stack.push({ kind: 'end', value: normalized, array });
    stack.push(array
      ? { kind: 'array', value: normalized, index: 0 }
      : { kind: 'object', value: normalized, entries: Object.entries(normalized), index: 0, first: true });
    yield array ? '[' : '{';
  }
}

export const writeJsonValue = async (stream, value, options = {}) => {
  const timing = options.timing || null;
  let activeAt = timing ? performance.now() : 0;
  const pause = async (pending, kind) => {
    if (!timing) { await pending; return; }
    const startedAt = performance.now();
    timing.computeMs = (timing.computeMs || 0) + Math.max(0, startedAt - activeAt);
    try { await pending; } finally {
      activeAt = performance.now(); timing[kind] = (timing[kind] || 0) + Math.max(0, activeAt - startedAt);
    }
  };
  const cooperate = typeof options?.cooperate === 'function' ? options.cooperate : createCooperativeYielder();
  const cooperateLarge = typeof options?.cooperate === 'function' ? options.cooperate : createCooperativeYielder({ every: 1 });
  const maxChunkChars = 64 * 1024;
  let parts = [], chars = 0;
  const flush = () => {
    const chunk = parts.join('');
    parts = []; chars = 0;
    return writeChunkIfNeeded(stream, chunk);
  };
  for (const fragment of iterateJsonFragments(value, new WeakSet())) {
    throwIfAborted(options.signal);
    for (let offset = 0; offset < fragment.length;) {
      let length = Math.min(maxChunkChars - chars, fragment.length - offset);
      const last = fragment.charCodeAt(offset + length - 1);
      const next = fragment.charCodeAt(offset + length);
      if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) length -= 1;
      if (!length) {
        const pending = flush();
        if (pending) await pause(pending, 'writeWaitMs');
        continue;
      }
      parts.push(fragment.slice(offset, offset + length));
      chars += length; offset += length;
      if (chars === maxChunkChars) {
        const pending = flush();
        if (pending) await pause(pending, 'writeWaitMs');
      }
    }
    const pending = fragment.length >= JSON_STRING_BATCH_CHARS ? cooperateLarge() : cooperate();
    if (pending) await pause(pending, 'cooperativeWaitMs');
  }
  if (chars) { const pending = flush(); if (pending) await pause(pending, 'writeWaitMs'); }
  if (timing) timing.computeMs = (timing.computeMs || 0) + Math.max(0, performance.now() - activeAt);
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
