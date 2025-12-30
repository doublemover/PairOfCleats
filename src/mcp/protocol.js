/**
 * Send a JSON-RPC payload with Content-Length framing.
 * @param {object} payload
 * @param {NodeJS.WritableStream} [output]
 */
export function sendMessage(payload, output = process.stdout) {
  const json = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  output.write(header + json);
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
export function sendError(id, code, message, output = process.stdout) {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } }, output);
}
