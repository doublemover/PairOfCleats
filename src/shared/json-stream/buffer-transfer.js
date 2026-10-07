import { isMarkedAsUntransferable } from 'node:worker_threads';

/** Keep worker transfers from detaching aliases or transferring Node's Buffer pool. */
export const toTransferableBuffer = (value) => {
  const buffer = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : Buffer.from(value);
  if (buffer.buffer instanceof ArrayBuffer
    && buffer.byteOffset === 0
    && buffer.byteLength === buffer.buffer.byteLength
    && !isMarkedAsUntransferable(buffer.buffer)) {
    return buffer;
  }
  const owned = Buffer.allocUnsafeSlow(buffer.length);
  buffer.copy(owned);
  return owned;
};
