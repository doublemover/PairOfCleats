import { buildErrorPayload, ERROR_CODES, isErrorCode, resolveErrorHint } from '../../shared/error-codes.js';
import { closeJsonRpcWriter, writeFramedJsonRpc } from '../../shared/jsonrpc.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

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

const resolveToolErrorCode = (error) => {
  if (isErrorCode(error?.code)) return error.code;
  if (error?.code === 'ERR_ABORTED' || error?.name === 'AbortError') {
    return ERROR_CODES.CANCELLED;
  }
  return ERROR_CODES.INTERNAL;
};

export function formatToolError(error) {
  const code = resolveToolErrorCode(error);
  const payload = buildErrorPayload({
    code,
    message: error?.message || String(error)
  });
  if (!isErrorCode(error?.code) && error?.code != null) {
    const numericCode = Number(error.code);
    if (Number.isFinite(numericCode)) {
      payload.exitCode = numericCode;
    } else {
      payload.nativeCode = String(error.code);
    }
  }
  if (error?.stderr) payload.stderr = String(error.stderr).trim();
  if (error?.stdout) payload.stdout = String(error.stdout).trim();
  if (error?.timeoutMs) payload.timeoutMs = error.timeoutMs;
  payload.hint = resolveErrorHint({
    code,
    message: payload.message,
    stderr: payload.stderr,
    stdout: payload.stdout,
    hint: error?.hint
  });
  return payload;
}

export function buildInitializeResult({
  protocolVersion = MCP_PROTOCOL_VERSION,
  serverInfo,
  schemaVersion,
  toolVersion,
  capabilities
} = {}) {
  const baseCapabilities = {
    tools: { listChanged: false },
    resources: { listChanged: false }
  };
  if (capabilities && typeof capabilities === 'object') {
    baseCapabilities.experimental = {
      pairofcleats: {
        schemaVersion: schemaVersion || null,
        toolVersion: toolVersion || null,
        capabilities
      }
    };
  }
  const result = {
    protocolVersion,
    serverInfo,
    capabilities: baseCapabilities
  };
  if (schemaVersion) result.schemaVersion = schemaVersion;
  if (toolVersion) result.toolVersion = toolVersion;
  return result;
}
