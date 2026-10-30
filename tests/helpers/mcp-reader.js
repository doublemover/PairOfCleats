const defaults = Object.freeze({ maxHeaderBytes: 8192, maxMessageBytes: 8 * 1024 * 1024,
  maxRetainedBytes: 16 * 1024 * 1024, maxPendingMessages: 1024, maxNotifications: 256 });
const decoder = new TextDecoder('utf-8', { fatal: true });
const own = (value, key) => Object.hasOwn(value, key);

/** Independent test oracle: transport selection is explicit, never inferred
 * from pipe fragments. One listener owner retains bytes between reads. */
export const createMcpTestReader = (stream, { transport, onActivity = null, ...limits } = {}) => {
  const framing = transport === 'sdk' || transport === 'line' ? 'line' : transport === 'legacy' ? 'legacy' : null;
  if (!framing) throw new TypeError('MCP test reader requires legacy or line framing.');
  if (Object.keys(limits).some(key => !own(defaults, key))) throw new TypeError('Unknown MCP reader bound.');
  const bounds = { ...defaults, ...limits };
  for (const [key, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > defaults[key]) throw new TypeError('Invalid MCP reader bound: ' + key);
  }
  const header = Buffer.alloc(bounds.maxHeaderBytes), notifications = [], messages = [], sizes = new WeakMap();
  let headerBytes = 0, headerLineStart = 0, expectedBytes = null, bodyBytes = 0, parts = [], partUsed = 0, queuedBytes = 0, deliveryBytes = 0;
  let pending = null, failure = null, ended = false, reading = false, delivered = 0, peakWireBytes = 0, peakSegments = 0;
  const notificationBytes = () => notifications.reduce((sum, value) => sum + (sizes.get(value) || 0), 0);
  const retainedBytes = () => headerBytes + bodyBytes + queuedBytes + deliveryBytes + notificationBytes();
  const protocolError = (reason, cause = undefined) => Object.assign(new Error('MCP test reader: ' + reason, { cause }), {
    code: 'ERR_MCP_TEST_PROTOCOL', reason, transport: framing
  });
  const detach = () => {
    stream.off('data', onData); stream.off('end', onEnd); stream.off('close', onClose); stream.off('error', onError);
  };
  const terminate = error => {
    if (failure) return;
    failure = error; detach();
    headerBytes = 0; bodyBytes = 0; expectedBytes = null; parts = []; partUsed = 0; messages.length = 0; queuedBytes = 0;
    if (pending) { const waiter = pending; pending = null; waiter.reject(error); }
  };
  const admitBytes = additional => {
    const bytes = retainedBytes() + additional;
    if (bytes > bounds.maxRetainedBytes) throw protocolError('retained-byte-limit');
    peakWireBytes = Math.max(peakWireBytes, bytes);
  };
  const takeMessage = () => {
    const entry = messages.shift(); queuedBytes -= entry.bytes; deliveryBytes += entry.bytes; delivered++;
    return entry.value;
  };
  const decodeMessage = buffer => {
    let value;
    try { value = JSON.parse(decoder.decode(buffer)); }
    catch (error) { throw protocolError('invalid-utf8-or-json', error); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0') throw protocolError('invalid-jsonrpc-envelope');
    if (!own(value, 'id')) {
      if (typeof value.method !== 'string' || !value.method || own(value, 'result') || own(value, 'error')
        || (own(value, 'params') && (!value.params || typeof value.params !== 'object'))) throw protocolError('invalid-notification');
    } else {
      if (!(value.id === null || typeof value.id === 'string' || Number.isSafeInteger(value.id))
        || own(value, 'result') === own(value, 'error') || own(value, 'method')) throw protocolError('invalid-response');
      if (own(value, 'error') && (!value.error || typeof value.error !== 'object' || Array.isArray(value.error)
        || !Number.isSafeInteger(value.error.code) || typeof value.error.message !== 'string')) throw protocolError('invalid-error-response');
    }
    sizes.set(value, buffer.length);
    return value;
  };
  const publishBody = () => {
    let buffer = Buffer.concat(parts, bodyBytes);
    if (framing === 'line' && buffer.at(-1) === 0x0d) buffer = buffer.subarray(0, -1);
    const value = decodeMessage(buffer), bytes = buffer.length;
    parts = []; partUsed = 0; bodyBytes = 0; expectedBytes = null;
    admitBytes(bytes);
    if (messages.length >= bounds.maxPendingMessages) throw protocolError('pending-message-limit');
    messages.push({ value, bytes }); queuedBytes += bytes;
    if (pending) { const waiter = pending; pending = null; waiter.resolve(takeMessage()); }
  };
  const parseHeader = () => {
    for (let index = 0; index < headerBytes; index++) {
      if (header[index] > 0x7f || header[index] === 0) throw protocolError('invalid-header-encoding');
    }
    const fields = new Map();
    for (const line of header.subarray(0, headerBytes - 4).toString('ascii').split('\r\n')) {
      const match = /^([!#$%&'*+.^_`|~A-Za-z0-9-]+):[ \t]*([^\r\n]*)$/.exec(line);
      if (!match || fields.has(match[1].toLowerCase())) throw protocolError('invalid-or-duplicate-header');
      fields.set(match[1].toLowerCase(), match[2].trim());
    }
    const length = fields.get('content-length');
    if (!length || !/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) < 1
      || Number(length) > bounds.maxMessageBytes) throw protocolError('invalid-content-length');
    expectedBytes = Number(length); headerBytes = 0; headerLineStart = 0;
    if (retainedBytes() + expectedBytes > bounds.maxRetainedBytes) throw protocolError('declared-body-exceeds-retained-limit');
  };
  const retain = slice => {
    admitBytes(slice.length);
    // Fixed owned slabs bound metadata independently of stream fragmentation;
    // no incoming slice retains an arbitrarily large backing chunk.
    let offset = 0;
    while (offset < slice.length) {
      let part = parts.at(-1);
      if (!part || partUsed === part.length) {
        part = Buffer.allocUnsafe(Math.min(65536, (expectedBytes ?? bounds.maxMessageBytes) - bodyBytes));
        parts.push(part); partUsed = 0; peakSegments = Math.max(peakSegments, parts.length);
      }
      const extent = Math.min(part.length - partUsed, slice.length - offset);
      slice.copy(part, partUsed, offset, offset + extent);
      partUsed += extent; bodyBytes += extent; offset += extent;
    }
  };
  const onData = chunk => {
    if (failure || ended) return;
    try {
      if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) throw protocolError('non-byte-stream');
      onActivity?.();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      let offset = 0;
      while (offset < bytes.length) {
        if (framing === 'legacy' && expectedBytes === null) {
          if (headerBytes === bounds.maxHeaderBytes) throw protocolError('header-byte-limit');
          admitBytes(1); header[headerBytes++] = bytes[offset++];
          if (header[headerBytes - 1] > 0x7f || header[headerBytes - 1] === 0) throw protocolError('invalid-header-encoding');
          if (header[headerBytes - 1] === 10) {
            if (headerBytes < 2 || header[headerBytes - 2] !== 13) throw protocolError('invalid-header-line');
            if (headerBytes >= 4 && header[headerBytes - 4] === 13 && header[headerBytes - 3] === 10) parseHeader();
            else {
              const line = header.subarray(headerLineStart, headerBytes - 2).toString('ascii');
              if (!/^[!#$%&'*+.^_`|~A-Za-z0-9-]+:[ \t]*[^\r\n]*$/.test(line)) throw protocolError('invalid-header-line');
              headerLineStart = headerBytes;
            }
          }
          continue;
        }
        if (framing === 'legacy') {
          const extent = Math.min(expectedBytes - bodyBytes, bytes.length - offset);
          retain(bytes.subarray(offset, offset + extent)); offset += extent;
          if (bodyBytes === expectedBytes) publishBody();
        } else {
          const newline = bytes.indexOf(10, offset), end = newline < 0 ? bytes.length : newline;
          if (bodyBytes + end - offset > bounds.maxMessageBytes) throw protocolError('line-byte-limit');
          retain(bytes.subarray(offset, end)); offset = newline < 0 ? end : end + 1;
          if (newline >= 0) publishBody();
        }
      }
    } catch (error) { terminate(error); }
  };
  const onEnd = () => {
    if (failure || ended) return;
    if (headerBytes || bodyBytes || expectedBytes !== null) {
      terminate(protocolError(framing === 'legacy' && expectedBytes === null ? 'eof-mid-header' : 'eof-mid-body'));
      return;
    }
    ended = true; detach();
    if (pending) {
      const waiter = pending; pending = null;
      waiter.reject(Object.assign(new Error('MCP server stream ended before the next message.'), { code: 'ERR_MCP_TEST_STREAM_CLOSED' }));
    }
  };
  const onClose = () => onEnd();
  const onError = error => terminate(error);
  const readRaw = () => {
    if (failure) return Promise.reject(failure);
    if (messages.length) return Promise.resolve(takeMessage());
    if (ended) return Promise.reject(Object.assign(new Error('MCP server stream has ended.'), { code: 'ERR_MCP_TEST_STREAM_CLOSED' }));
    return new Promise((resolve, reject) => { pending = { resolve, reject }; });
  };
  const cancelPending = error => terminate(error instanceof Error ? error : protocolError('canceled'));
  const read = async (includeNotifications, { signal = null } = {}) => {
    if (reading) throw Object.assign(new Error('MCP test reader permits one pending read.'), { code: 'ERR_MCP_TEST_CONCURRENT_READ' });
    reading = true;
    const abort = () => cancelPending(Object.assign(new Error('MCP read canceled.', { cause: signal.reason }), { name: 'AbortError', code: 'ABORT_ERR' }));
    try {
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      while (true) {
        const value = await readRaw();
        if (failure) throw failure;
        onActivity?.();
        if (value.method && !own(value, 'id')) {
          if (notifications.length >= bounds.maxNotifications) {
            const error = protocolError('notification-count-limit'); terminate(error); throw error;
          }
          const size = sizes.get(value) || 0; deliveryBytes -= size; admitBytes(size); notifications.push(value);
          if (!includeNotifications) continue;
        }
        return value;
      }
    } finally { deliveryBytes = 0; reading = false; signal?.removeEventListener('abort', abort); }
  };
  stream.on('data', onData); stream.on('end', onEnd); stream.on('close', onClose); stream.on('error', onError);
  if (stream.readableEnded || stream.destroyed) onEnd();
  return { readMessage: options => read(false, options), readAnyMessage: options => read(true, options), notifications, cancelPending,
    getState: () => ({ transport: framing, state: failure ? 'failed' : ended ? 'ended' : 'open', retainedWireBytes: retainedBytes(),
      peakRetainedWireBytes: peakWireBytes, pendingMessages: messages.length, notifications: notifications.length,
      bufferSegments: parts.length, peakBufferSegments: peakSegments, reading, delivered, failureCode: failure?.code || null }) };
};
