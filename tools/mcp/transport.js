import { createFramedJsonRpcParser } from '../../src/shared/jsonrpc.js';
import {
  buildInitializeResult,
  closeOutput,
  formatToolError,
  sendError,
  sendNotification,
  sendResult
} from '../../src/integrations/mcp/protocol.js';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { logError } from '../../src/shared/progress.js';
import { withTimeout } from './runner.js';

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
 * @param {{toolDefs:any,schemaVersion?:string,toolVersion?:string,serverInfo:{name:string,version:string},handleToolCall:Function,resolveToolTimeoutMs:Function,queueMax:number,maxBufferBytes?:number,capabilities?:object}} config
 */
export const createMcpTransport = ({
  toolDefs,
  schemaVersion,
  toolVersion,
  serverInfo,
  handleToolCall,
  resolveToolTimeoutMs,
  queueMax,
  maxBufferBytes,
  capabilities
}) => {
  let processing = false;
  const queue = [];
  const inFlight = new Map();

  const sendCancelledResponse = (id) => {
    const payload = formatToolError({ code: ERROR_CODES.CANCELLED, message: 'Request cancelled.' });
    sendResult(id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
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
      sendResult(id, buildInitializeResult({
        serverInfo,
        schemaVersion,
        toolVersion,
        capabilities
      }));
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
      sendError(id, -32601, `Method not found: ${method}`, undefined, { code: ERROR_CODES.NOT_FOUND });
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
