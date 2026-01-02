/**
 * Write a JSON-RPC message with Content-Length framing.
 * @param {import('node:stream').Writable} outputStream
 * @param {object} payload
 */
export function writeFramedJsonRpc(outputStream, payload) {
  if (!outputStream || typeof outputStream.write !== 'function') {
    throw new Error('writeFramedJsonRpc requires a writable stream.');
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = `Content-Length: ${body.length}\r\n\r\n`;
  outputStream.write(header);
  outputStream.write(body);
}

/**
 * Create a framed JSON-RPC parser for Content-Length-delimited payloads.
 * @param {{onMessage?:(msg:object)=>void,onError?:(err:Error)=>void,maxBufferBytes?:number}} input
 * @returns {{push:(chunk:Buffer|string)=>void}}
 */
export function createFramedJsonRpcParser({ onMessage, onError, maxBufferBytes } = {}) {
  const handleMessage = typeof onMessage === 'function' ? onMessage : () => {};
  const handleError = typeof onError === 'function' ? onError : () => {};
  const maxBuffer = Number.isFinite(Number(maxBufferBytes))
    ? Math.max(0, Number(maxBufferBytes))
    : 8 * 1024 * 1024;
  let buffer = Buffer.alloc(0);

  const parse = () => {
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const headerText = buffer.slice(0, headerEnd).toString('utf8');
      const match = headerText.match(/content-length\s*:\s*(\d+)/i);
      if (!match) {
        handleError(new Error('JSON-RPC frame missing Content-Length header.'));
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      if (!Number.isFinite(length) || length < 0) {
        handleError(new Error('JSON-RPC frame has invalid Content-Length.'));
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;
      const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
      buffer = buffer.slice(bodyEnd);
      try {
        const message = JSON.parse(body);
        handleMessage(message);
      } catch (err) {
        handleError(err instanceof Error ? err : new Error('Invalid JSON-RPC payload.'));
      }
    }
  };

  return {
    push(chunk) {
      if (!chunk || chunk.length === 0) return;
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (maxBuffer && buffer.length + next.length > maxBuffer) {
        handleError(new Error('JSON-RPC buffer exceeded maximum size.'));
        buffer = Buffer.alloc(0);
        return;
      }
      if (buffer.length === 0) {
        buffer = next;
      } else {
        buffer = Buffer.concat([buffer, next], buffer.length + next.length);
      }
      parse();
    }
  };
}
