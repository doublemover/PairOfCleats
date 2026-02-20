import { StreamMessageWriter } from 'vscode-jsonrpc';

const writerCache = new WeakMap();
const CLOSED_STREAM_WRITE_ERROR_CODES = new Set([
  'ERR_STREAM_DESTROYED',
  'EPIPE',
  'ECONNRESET',
  'ERR_SOCKET_CLOSED',
  'EOF'
]);

const isClosedStreamWriteError = (err) => {
  const code = String(err?.code || '').toUpperCase();
  if (code && CLOSED_STREAM_WRITE_ERROR_CODES.has(code)) return true;
  const message = String(err?.message || err || '');
  return /\bEPIPE\b/i.test(message) || /stream (?:is )?closed/i.test(message);
};

const getWriterState = (outputStream) => {
  let state = writerCache.get(outputStream);
  if (state) return state;
  const writer = new StreamMessageWriter(outputStream);
  state = { writer, closed: false, queue: Promise.resolve() };
  const markClosed = () => {
    state.closed = true;
  };
  if (typeof outputStream.once === 'function') {
    outputStream.once('close', markClosed);
    outputStream.once('finish', markClosed);
    outputStream.once('error', markClosed);
  }
  writerCache.set(outputStream, state);
  return state;
};

/**
 * Get a JSON-RPC writer bound to a specific stream with serialized writes.
 * @param {import('node:stream').Writable} outputStream
 * @returns {{write:(payload:object)=>Promise<void>,close:()=>void}}
 */
export function getJsonRpcWriter(outputStream) {
  if (!outputStream || typeof outputStream.write !== 'function') {
    throw new Error('getJsonRpcWriter requires a writable stream.');
  }
  const state = getWriterState(outputStream);
  const write = (payload) => {
    const run = async () => {
      if (state.closed || outputStream.destroyed || outputStream.writableEnded) {
        throw new Error('JSON-RPC stream closed.');
      }
      return state.writer.write(payload);
    };
    state.queue = state.queue.then(run, run);
    return state.queue.catch((err) => {
      if (isClosedStreamWriteError(err)) {
        state.closed = true;
      }
      throw err;
    });
  };
  const close = () => {
    state.closed = true;
    state.writer.dispose?.();
    writerCache.delete(outputStream);
  };
  return { write, close };
}

/**
 * Close and dispose a cached JSON-RPC writer for a stream.
 * @param {import('node:stream').Writable} outputStream
 */
export function closeJsonRpcWriter(outputStream) {
  const state = writerCache.get(outputStream);
  if (!state) return;
  state.closed = true;
  state.writer.dispose?.();
  writerCache.delete(outputStream);
}

/**
 * Write a JSON-RPC message with Content-Length framing.
 * @param {import('node:stream').Writable} outputStream
 * @param {object} payload
 * @returns {Promise<void>|void}
 */
export function writeFramedJsonRpc(outputStream, payload) {
  return getJsonRpcWriter(outputStream).write(payload);
}

/**
 * Create a framed JSON-RPC parser for Content-Length-delimited payloads.
 * @param {{onMessage?:(msg:object)=>void,onError?:(err:Error)=>void,maxBufferBytes?:number,maxHeaderBytes?:number,maxMessageBytes?:number}} input
 * @returns {{push:(chunk:Buffer|string)=>void,dispose:()=>void}}
 */
export function createFramedJsonRpcParser({
  onMessage,
  onError,
  maxBufferBytes = 8 * 1024 * 1024,
  maxHeaderBytes = 64 * 1024,
  maxMessageBytes = null
} = {}) {
  const handleMessage = typeof onMessage === 'function' ? onMessage : () => {};
  const handleError = typeof onError === 'function' ? onError : () => {};
  const maxMessage = Number.isFinite(Number(maxMessageBytes)) && Number(maxMessageBytes) > 0
    ? Math.floor(Number(maxMessageBytes))
    : (Number.isFinite(Number(maxBufferBytes)) && Number(maxBufferBytes) > 0
      ? Math.floor(Number(maxBufferBytes))
      : null);
  const maxBuffer = Number.isFinite(Number(maxBufferBytes)) && Number(maxBufferBytes) > 0
    ? Math.floor(Number(maxBufferBytes))
    : null;
  const maxHeader = Number.isFinite(Number(maxHeaderBytes)) && Number(maxHeaderBytes) > 0
    ? Math.floor(Number(maxHeaderBytes))
    : null;
  const buffers = [];
  let bufferLength = 0;
  let closed = false;
  const fail = (message) => {
    if (closed) return;
    closed = true;
    buffers.length = 0;
    bufferLength = 0;
    handleError(new Error(message));
  };
  const appendBuffer = (chunk) => {
    buffers.push(chunk);
    bufferLength += chunk.length;
  };
  const takeBytes = (length) => {
    const size = Math.max(0, Math.floor(length));
    if (!size) return Buffer.alloc(0);
    const out = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size && buffers.length) {
      const head = buffers[0];
      const take = Math.min(head.length, size - offset);
      head.copy(out, offset, 0, take);
      offset += take;
      if (take === head.length) {
        buffers.shift();
      } else {
        buffers[0] = head.subarray(take);
      }
    }
    bufferLength = Math.max(0, bufferLength - size);
    return out;
  };
  const peekBytes = (length) => {
    const size = Math.max(0, Math.floor(length));
    if (!size) return Buffer.alloc(0);
    const out = Buffer.allocUnsafe(size);
    let offset = 0;
    for (const head of buffers) {
      if (offset >= size) break;
      const take = Math.min(head.length, size - offset);
      head.copy(out, offset, 0, take);
      offset += take;
    }
    return out;
  };
  const discardBytes = (length) => {
    const size = Math.max(0, Math.floor(length));
    if (!size) return;
    let remaining = size;
    while (remaining > 0 && buffers.length) {
      const head = buffers[0];
      if (head.length <= remaining) {
        buffers.shift();
        remaining -= head.length;
      } else {
        buffers[0] = head.subarray(remaining);
        remaining = 0;
      }
    }
    bufferLength = Math.max(0, bufferLength - size);
  };
  const findHeaderEnd = () => {
    if (!buffers.length) return -1;
    const delim = Buffer.from('\r\n\r\n');
    let offset = 0;
    let carry = null;
    for (const buf of buffers) {
      if (!buf.length) {
        offset += buf.length;
        continue;
      }
      const combined = carry ? Buffer.concat([carry, buf]) : buf;
      const idx = combined.indexOf(delim);
      if (idx !== -1) {
        return offset - (carry ? carry.length : 0) + idx;
      }
      const carryStart = Math.max(0, combined.length - (delim.length - 1));
      carry = combined.subarray(carryStart);
      offset += buf.length;
    }
    return -1;
  };
  const parseHeaders = (raw) => {
    const lines = raw.split(/\r?\n/);
    let contentLength = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = /^content-length:\s*(\d+)\s*$/i.exec(trimmed);
      if (match) {
        contentLength = Number.parseInt(match[1], 10);
        break;
      }
    }
    return contentLength;
  };
  const parseBuffer = () => {
    while (!closed) {
      const headerEnd = findHeaderEnd();
      if (headerEnd === -1) {
        if (maxHeader && bufferLength > maxHeader) {
          fail(`JSON-RPC header exceeded ${maxHeader} bytes.`);
        }
        return;
      }
      if (maxHeader && headerEnd > maxHeader) {
        fail(`JSON-RPC header exceeded ${maxHeader} bytes.`);
        return;
      }
      const headerRaw = peekBytes(headerEnd).toString('utf8');
      const contentLength = parseHeaders(headerRaw);
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        fail('JSON-RPC Content-Length header missing or invalid.');
        return;
      }
      if (maxMessage && contentLength > maxMessage) {
        fail(`JSON-RPC message exceeded ${maxMessage} bytes.`);
        return;
      }
      const frameEnd = headerEnd + 4 + contentLength;
      if (bufferLength < frameEnd) return;
      discardBytes(headerEnd + 4);
      const payloadBuffer = takeBytes(contentLength);
      try {
        const message = JSON.parse(payloadBuffer.toString('utf8'));
        handleMessage(message);
      } catch (err) {
        fail(`JSON-RPC payload parse error: ${err?.message || err}`);
        return;
      }
    }
  };

  return {
    push(chunk) {
      if (closed || !chunk || chunk.length === 0) return;
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!incoming.length) return;
      if (maxBuffer && bufferLength + incoming.length > maxBuffer) {
        fail(`JSON-RPC buffer exceeded ${maxBuffer} bytes.`);
        return;
      }
      appendBuffer(incoming);
      parseBuffer();
    },
    dispose() {
      closed = true;
      buffers.length = 0;
      bufferLength = 0;
    }
  };
}
