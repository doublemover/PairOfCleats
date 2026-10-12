import { ToolingRequiredComputationError } from '../../required-computation.js';

export const TYPESCRIPT_RUNTIME_PROTOCOL_VERSION = 1;
export const DEFAULT_PROTOCOL_LIMITS = Object.freeze({
  maxRecordBytes: 8 * 1024 * 1024,
  maxInputBytes: 256 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxRecords: 1000000,
  maxDepth: 64
});

export const protocolFailure = (reason, details = null, cause) => (
  new ToolingRequiredComputationError(`TypeScript subprocess protocol: ${reason}.`, {
    operation: 'typescript-subprocess', reason, details, cause
  })
);

export const resolveProtocolLimits = (input = {}) => {
  const limits = { ...DEFAULT_PROTOCOL_LIMITS, ...input };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_PROTOCOL_LIMITS, key)
      || !Number.isSafeInteger(value) || value <= 0) {
      throw protocolFailure('invalid-limit', { key });
    }
  }
  return limits;
};

// Count JSON UTF-8 bytes before stringify. Only inert JSON data is admitted:
// no toJSON hooks, getters, class instances, cycles or silently lost callbacks.
// Counting stops at the record cap, including for alias-expanded object graphs.
export const measureJsonRecord = (value, limits = DEFAULT_PROTOCOL_LIMITS) => {
  let bytes = 1; // terminating newline
  const ancestors = new Set();
  const charge = amount => {
    bytes += amount;
    if (bytes > limits.maxRecordBytes) throw protocolFailure('record-byte-limit', { limit: limits.maxRecordBytes });
  };
  const stringBytes = text => {
    charge(2);
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) charge(2);
      else if (code < 32) charge(6);
      else if (code < 128) charge(1);
      else if (code < 2048) charge(2);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { charge(4); i += 1; } else charge(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) charge(6);
      else charge(3);
    }
  };
  const visit = (item, depth) => {
    if (depth > limits.maxDepth) throw protocolFailure('record-depth-limit', { limit: limits.maxDepth });
    if (item === null) { charge(4); return; }
    if (typeof item === 'string') { stringBytes(item); return; }
    if (typeof item === 'boolean') { charge(item ? 4 : 5); return; }
    if (typeof item === 'number' && Number.isFinite(item)) { charge(String(item).length); return; }
    if (!item || typeof item !== 'object') throw protocolFailure('non-json-value');
    if (ancestors.has(item)) throw protocolFailure('cyclic-record');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) throw protocolFailure('non-json-object');
    if (Object.hasOwn(item, 'toJSON') || Object.getOwnPropertySymbols(item).length) throw protocolFailure('non-json-object');
    ancestors.add(item);
    charge(2);
    let count = 0;
    if (array) {
      for (let i = 0; i < item.length; i += 1) {
        if (count++) charge(1);
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        if (descriptor && !Object.hasOwn(descriptor, 'value')) throw protocolFailure('non-json-accessor');
        visit(descriptor?.value === undefined ? null : descriptor.value, depth + 1);
      }
    } else {
      for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!Object.hasOwn(descriptor, 'value')) throw protocolFailure('non-json-accessor');
        if (descriptor.value === undefined) continue;
        if (count++) charge(1);
        stringBytes(key); charge(1); visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  return bytes;
};

export const createRecordWriter = (stream, limits, maxTotalBytes) => {
  let totalBytes = 0, count = 0;
  let streamError = null;
  stream.on('error', error => { streamError ||= error; });
  const encode = (record, bytes) => {
    if (streamError) throw streamError;
    if (++count > limits.maxRecords) throw protocolFailure('record-count-limit');
    if (totalBytes + bytes > maxTotalBytes) throw protocolFailure('total-byte-limit', { limit: maxTotalBytes });
    totalBytes += bytes;
    const encoded = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(encoded) !== bytes) throw protocolFailure('encoding-accounting-mismatch');
    return encoded;
  };
  const write = async record => {
    const encoded = encode(record, measureJsonRecord(record, limits));
    // One write at a time. Awaiting its callback propagates pipe backpressure,
    // rather than collecting every record in the Writable's internal queue.
    await new Promise((resolve, reject) => stream.write(encoded, error => error ? reject(error) : resolve()));
  };
  // Synchronous telemetry cannot await drain while a checker call is blocked.
  // Admit only a bounded pending write, using the SAME counters and stream as
  // semantic records. A rejected telemetry admission must be counted by caller.
  write.tryWrite = (record, maxBufferedBytes) => {
    const bytes = measureJsonRecord(record, limits);
    if (bytes + stream.writableLength > maxBufferedBytes) return false;
    const encoded = encode(record, bytes);
    stream.write(encoded, error => { if (error) streamError ||= error; });
    return true;
  };
  return write;
};

export async function* readRecords(stream, limits, maxTotalBytes) {
  let totalBytes = 0, pendingBytes = 0, count = 0;
  let pieces = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const input of stream) {
    const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
    totalBytes += chunk.length;
    if (totalBytes > maxTotalBytes) throw protocolFailure('total-byte-limit', { limit: maxTotalBytes });
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      pendingBytes += part.length;
      if (pendingBytes + 1 > limits.maxRecordBytes) throw protocolFailure('record-byte-limit', { limit: limits.maxRecordBytes });
      if (part.length) pieces.push(part);
      if (newline < 0) break;
      if (++count > limits.maxRecords) throw protocolFailure('record-count-limit');
      let record;
      try {
        record = JSON.parse(decoder.decode(Buffer.concat(pieces, pendingBytes)));
      } catch (error) { throw protocolFailure('malformed-record', null, error); }
      pieces = []; pendingBytes = 0;
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw protocolFailure('malformed-record');
      measureJsonRecord(record, limits);
      yield record;
      start = newline + 1;
    }
  }
  if (pendingBytes) throw protocolFailure('unterminated-record');
}
