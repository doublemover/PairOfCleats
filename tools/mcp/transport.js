import { StreamMessageReader } from 'vscode-jsonrpc';
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
    return 'Run `npm run build-sqlite-index` or set sqlite.use=false / --backend memory.';
  }
  if (parts.includes('better-sqlite3 is required')) {
    return 'Run `npm install` and ensure better-sqlite3 can load on this platform.';
  }
  if (parts.includes('chunk_meta.json')
    || parts.includes('minhash_signatures')
    || parts.includes('index not found')
    || parts.includes('build-index')
    || parts.includes('build index')) {
    return 'Run `npm run build-index` (or `npm run setup`/`npm run bootstrap`) to generate indexes.';
  }
  if ((parts.includes('model') || parts.includes('xenova') || parts.includes('transformers'))
    && (parts.includes('not found') || parts.includes('failed') || parts.includes('fetch') || parts.includes('download') || parts.includes('enoent'))) {
    return 'Run `npm run download-models` or use `--stub-embeddings` / `PAIROFCLEATS_EMBEDDINGS=stub`.';
  }
  if (parts.includes('dictionary')
    || parts.includes('wordlist')
    || parts.includes('words_alpha')
    || parts.includes('download-dicts')) {
    return 'Run `npm run download-dicts -- --lang en` (or configure dictionary.files/languages).';
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
 * @param {{toolDefs:any,serverInfo:{name:string,version:string},handleToolCall:Function,resolveToolTimeoutMs:Function,queueMax:number}} config
 */
export const createMcpTransport = ({ toolDefs, serverInfo, handleToolCall, resolveToolTimeoutMs, queueMax }) => {
  let processing = false;
  const queue = [];

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

    if (method === 'tools/call') {
      if (!id) return;
      const name = params?.name;
      const args = params?.arguments || {};
      const timeoutMs = resolveToolTimeoutMs(name, args);
      try {
        let timedOut = false;
        const progress = (payload) => {
          if (timedOut) return;
          sendProgress(id, name, payload);
        };
        const result = await withTimeout(
          handleToolCall(name, args, { progress, toolCallId: id }),
          timeoutMs,
          { label: name, onTimeout: () => { timedOut = true; } }
        );
        sendResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        });
      } catch (error) {
        const payload = formatToolError(error);
        if (error?.code === 'TOOL_TIMEOUT' && timeoutMs) {
          payload.timeoutMs = timeoutMs;
        }
        sendResult(id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError: true
        });
      }
      return;
    }

    if (id) {
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
    const reader = new StreamMessageReader(process.stdin);
    reader.onError((err) => logError('[mcp] stream error', { error: err?.message || String(err) }));
    reader.onClose(() => {
      closeOutput();
      process.exit(0);
    });
    reader.listen(enqueueMessage);
    return reader;
  };

  return { start };
};
