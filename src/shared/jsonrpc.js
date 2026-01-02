import { PassThrough } from 'node:stream';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc';

/**
 * Write a JSON-RPC message with Content-Length framing.
 * @param {import('node:stream').Writable} outputStream
 * @param {object} payload
 * @returns {Promise<void>|void}
 */
export function writeFramedJsonRpc(outputStream, payload) {
  if (!outputStream || typeof outputStream.write !== 'function') {
    throw new Error('writeFramedJsonRpc requires a writable stream.');
  }
  const writer = new StreamMessageWriter(outputStream);
  return writer.write(payload);
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
