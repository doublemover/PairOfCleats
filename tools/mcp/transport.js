import { createFramedJsonRpcParser } from '../../src/shared/jsonrpc.js';
import { closeOutput, sendError, sendNotification, sendResult } from '../../src/integrations/mcp/protocol.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { logError } from '../../src/shared/progress.js';
import { withTimeout } from './runner.js';

/**
 * Format error payloads for tool responses.
 * @param {any} error
 * @returns {{message:string,code?:number,stderr?:string,stdout?:string}} 
 */
function getRemediationHint(error) {
  const parts = [error?.message, error?.stderr, error?.stdout]
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
}

/**
 * Format error payloads for tool responses.
 * @param {any} error
 * @returns {{message:string,code?:number,stderr?:string,stdout?:string,hint?:string}}
 */
function formatToolError(error) {
  const payload = {
    message: error?.message || String(error)
  };
  if (error?.code !== undefined) payload.code = error.code;
  if (error?.stderr) payload.stderr = String(error.stderr).trim();
  if (error?.stdout) payload.stdout = String(error.stdout).trim();
  if (error?.timeoutMs) payload.timeoutMs = error.timeoutMs;
  const hint = getRemediationHint(error);
  if (hint) payload.hint = hint;
  return payload;
}

/**
 * Emit a progress notification for long-running tools.
 * @param {string|number|null} id
 * @param {string} tool
 * @param {{message:string,stream?:string,phase?:string}} payload
 */
function sendProgress(id, tool, payload) {
  if (id === null || id === undefined) return;
  const message = payload?.message ? String(payload.message) : '';
  if (!message) return;
  sendNotification('notifications/progress', {
    id,
    tool,
    message,
    stream: payload?.stream || 'info',
    phase: payload?.phase || 'progress',
    ts: new Date().toISOString()
  });
}

/**
 * Start the MCP stdio transport.
 * @param {{toolDefs:any,serverInfo:{name:string,version:string},handleToolCall:Function,resolveToolTimeoutMs:Function,queueMax:number,maxBufferBytes?:number}} config
 */
export const createMcpTransport = ({ toolDefs, serverInfo, handleToolCall, resolveToolTimeoutMs, queueMax, maxBufferBytes }) => {
  let processing = false;
  const queue = [];
  const inFlight = new Map();

  const sendCancelledResponse = (id) => {
    sendResult(id, {
      content: [{ type: 'text', text: JSON.stringify({ code: ERROR_CODES.CANCELLED, message: 'Request cancelled.' }, null, 2) }],
      isError: true
    });
  };

  const applyCancellation = (params) => {
    const cancelId = params?.id;
    if (cancelId === null || cancelId === undefined) return false;
    const entry = inFlight.get(cancelId);
    if (entry) {
      entry.cancelled = true;
      entry.controller.abort();
      return true;
    }
    return false;
  };

  /**
   * Handle a JSON-RPC message from stdin.
   * @param {object} message
   * @returns {Promise<void>}
   */
  async function handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0') return;
    const { id, method, params } = message;

    if (method === 'initialize') {
      sendResult(id, {
        protocolVersion: '2024-11-05',
        serverInfo,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false }
        }
      });
      return;
    }

    if (method === 'shutdown') {
      sendResult(id, {});
      return;
    }

    if (method === 'exit') {
      process.exit(0);
    }

    if (method === 'tools/list') {
      sendResult(id, { tools: toolDefs });
      return;
    }

    if (method === 'resources/list') {
      sendResult(id, { resources: [] });
      return;
    }

    if (method === '$/cancelRequest') {
      applyCancellation(params);
      return;
    }

    if (method === 'tools/call') {
      if (id === null || id === undefined) return;
      const name = params?.name;
      const args = params?.arguments || {};
      const timeoutMs = resolveToolTimeoutMs(name, args);
      try {
        const controller = new AbortController();
        const entry = { controller, cancelled: false };
        inFlight.set(id, entry);
        let timedOut = false;
        const progress = (payload) => {
          if (timedOut) return;
          sendProgress(id, name, payload);
        };
        const result = await withTimeout(
          handleToolCall(name, args, { progress, toolCallId: id, signal: controller.signal }),
          timeoutMs,
          {
            label: name,
            onTimeout: () => {
              timedOut = true;
              entry.cancelled = true;
              controller.abort();
            }
          }
        );
        if (entry.cancelled) {
          sendCancelledResponse(id);
          return;
        }
        sendResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        });
      } catch (error) {
        const entry = inFlight.get(id);
        if (entry?.cancelled && error?.code !== ERROR_CODES.TOOL_TIMEOUT) {
          sendCancelledResponse(id);
          return;
        }
        const payload = formatToolError(error);
        if (error?.code === 'TOOL_TIMEOUT' && timeoutMs) {
          payload.timeoutMs = timeoutMs;
        }
        sendResult(id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError: true
        });
      } finally {
        inFlight.delete(id);
      }
      return;
    }

    if (id !== null && id !== undefined) {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  /**
   * Process queued messages serially.
   */
  function processQueue() {
    if (processing) return;
    processing = true;
    const run = async () => {
      while (queue.length) {
        const msg = queue.shift();
        await handleMessage(msg);
      }
      processing = false;
    };
    run().catch((error) => {
      processing = false;
      logError('[mcp] queue error', { error: error?.message || String(error) });
    });
  }

  /**
   * Enqueue a message for processing.
   * @param {object} message
   */
  function enqueueMessage(message) {
    if (message?.method === '$/cancelRequest') {
      applyCancellation(message.params);
      return;
    }
    const inFlight = processing ? 1 : 0;
    if (queue.length + inFlight >= queueMax) {
      if (message?.id !== undefined && message?.id !== null) {
        sendError(message.id, -32001, 'Server overloaded.', undefined, { code: ERROR_CODES.QUEUE_OVERLOADED });
      }
      return;
    }
    queue.push(message);
    processQueue();
  }

  const start = () => {
    const parser = createFramedJsonRpcParser({
      onMessage: enqueueMessage,
      onError: (err) => {
        logError('[mcp] stream error', { error: err?.message || String(err) });
        closeOutput();
        process.exit(1);
      },
      maxBufferBytes
    });
    process.stdin.on('data', (chunk) => parser.push(chunk));
    process.stdin.on('end', () => {
      closeOutput();
      process.exit(0);
    });
    process.stdin.on('error', (err) => {
      logError('[mcp] stream error', { error: err?.message || String(err) });
      closeOutput();
      process.exit(1);
    });
    return parser;
  };

  return { start };
};
