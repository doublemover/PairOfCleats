import { StreamMessageWriter } from 'vscode-jsonrpc';

const writerCache = new WeakMap();

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
      if (err?.code === 'ERR_STREAM_DESTROYED') {
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
  let buffer = Buffer.alloc(0);
  let closed = false;
  const fail = (message) => {
    if (closed) return;
    closed = true;
    buffer = Buffer.alloc(0);
    handleError(new Error(message));
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
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        if (maxHeader && buffer.length > maxHeader) {
          fail(`JSON-RPC header exceeded ${maxHeader} bytes.`);
        }
        return;
      }
      if (maxHeader && headerEnd > maxHeader) {
        fail(`JSON-RPC header exceeded ${maxHeader} bytes.`);
        return;
      }
      const headerRaw = buffer.slice(0, headerEnd).toString('utf8');
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
      if (buffer.length < frameEnd) return;
      const payloadBuffer = buffer.slice(headerEnd + 4, frameEnd);
      buffer = buffer.slice(frameEnd);
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
      if (maxBuffer && buffer.length + incoming.length > maxBuffer) {
        fail(`JSON-RPC buffer exceeded ${maxBuffer} bytes.`);
        return;
      }
      buffer = buffer.length ? Buffer.concat([buffer, incoming]) : incoming;
      parseBuffer();
    },
    dispose() {
      closed = true;
      buffer = Buffer.alloc(0);
    }
  };
}
