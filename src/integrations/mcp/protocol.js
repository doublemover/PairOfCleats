import { ERROR_CODES, isErrorCode } from '../../shared/error-codes.js';
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

const MAX_HINT_INPUT = 16384;

const capHintInput = (value) => {
  if (!value) return '';
  const text = String(value);
  if (text.length <= MAX_HINT_INPUT) return text;
  return text.slice(0, MAX_HINT_INPUT);
};

const getRemediationHint = (error) => {
  const parts = [error?.message, error?.stderr, error?.stdout]
    .map(capHintInput)
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (!parts) return null;

  if (parts.includes('sqlite backend requested but index not found')
    || parts.includes('missing required tables')) {
    return 'Run `node tools/build-sqlite-index.js` or set sqlite.use=false / --backend memory.';
  }
  if (parts.includes('better-sqlite3 is required')) {
    return 'Run `npm install` and ensure better-sqlite3 can load on this platform.';
  }
  if (parts.includes('chunk_meta.json')
    || parts.includes('minhash_signatures')
    || parts.includes('index not found')
    || parts.includes('build-index')
    || parts.includes('build index')) {
    return 'Run `pairofcleats index build` (build-index) or `pairofcleats setup`/`pairofcleats bootstrap` to generate indexes.';
  }
  if ((parts.includes('model') || parts.includes('xenova') || parts.includes('transformers'))
    && (parts.includes('not found') || parts.includes('failed') || parts.includes('fetch') || parts.includes('download') || parts.includes('enoent'))) {
    return 'Run `node tools/download-models.js` or use `--stub-embeddings` / `PAIROFCLEATS_EMBEDDINGS=stub`.';
  }
  if (parts.includes('dictionary')
    || parts.includes('wordlist')
    || parts.includes('words_alpha')
    || parts.includes('download-dicts')) {
    return 'Run `node tools/download-dicts.js --lang en` (or configure dictionary.files/languages).';
  }
  return null;
};

const resolveToolErrorCode = (error) => {
  if (isErrorCode(error?.code)) return error.code;
  if (error?.code === 'ERR_ABORTED' || error?.name === 'AbortError') {
    return ERROR_CODES.CANCELLED;
  }
  return ERROR_CODES.INTERNAL;
};

export function formatToolError(error) {
  const code = resolveToolErrorCode(error);
  const payload = {
    code,
    message: error?.message || String(error)
  };
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
  const hint = getRemediationHint(error);
  if (hint) payload.hint = hint;
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
