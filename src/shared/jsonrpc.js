import { PassThrough } from 'node:stream';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc';

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
 * @param {{onMessage?:(msg:object)=>void,onError?:(err:Error)=>void,maxBufferBytes?:number}} input
 * @returns {{push:(chunk:Buffer|string)=>void,dispose:()=>void}}
 */
export function createFramedJsonRpcParser({ onMessage, onError } = {}) {
  const stream = new PassThrough();
  const reader = new StreamMessageReader(stream);
  const handleMessage = typeof onMessage === 'function' ? onMessage : () => {};
  const handleError = typeof onError === 'function' ? onError : () => {};

  reader.onError(handleError);
  reader.listen(handleMessage);

  return {
    push(chunk) {
      if (!chunk || chunk.length === 0) return;
      stream.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    dispose() {
      reader.dispose();
      stream.end();
    }
  };
}
