import { closeJsonRpcWriter, writeFramedJsonRpc } from '../../shared/jsonrpc.js';

/**
 * Send a JSON-RPC payload with Content-Length framing.
 * @param {object} payload
 * @param {NodeJS.WritableStream} [output]
 */
export function sendMessage(payload, output = process.stdout) {
  const pending = writeFramedJsonRpc(output, payload);
  if (pending && typeof pending.catch === 'function') {
    pending.catch(() => {});
  }
  return pending;
}

/**
 * Send a JSON-RPC notification.
 * @param {string} method
 * @param {object} params
 * @param {NodeJS.WritableStream} [output]
 */
export function sendNotification(method, params, output = process.stdout) {
  sendMessage({ jsonrpc: '2.0', method, params }, output);
}

/**
 * Send a JSON-RPC result response.
 * @param {string|number|null} id
 * @param {any} result
 * @param {NodeJS.WritableStream} [output]
 */
export function sendResult(id, result, output = process.stdout) {
  sendMessage({ jsonrpc: '2.0', id, result }, output);
}

/**
 * Send a JSON-RPC error response.
 * @param {string|number|null} id
 * @param {number} code
 * @param {string} message
 * @param {NodeJS.WritableStream} [output]
 */
export function sendError(id, code, message, output = process.stdout, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  sendMessage({ jsonrpc: '2.0', id, error }, output);
}

/**
 * Close the JSON-RPC writer for an output stream.
 * @param {NodeJS.WritableStream} [output]
 */
export function closeOutput(output = process.stdout) {
  closeJsonRpcWriter(output);
}
