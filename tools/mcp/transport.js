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
import { attachObservability, normalizeObservability } from '../../src/shared/observability.js';
import { logError } from '../../src/shared/progress.js';
import { withTimeout } from './runner.js';

/**
 * Start the MCP stdio transport.
 * @param {{toolDefs:any,schemaVersion?:string,toolVersion?:string,serverInfo:{name:string,version:string},handleToolCall:Function,resolveToolTimeoutMs:Function,queueMax:number,maxBufferBytes?:number,capabilities?:object,capabilityManifest?:object}} config
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
  capabilities,
  capabilityManifest
}) => {
  const inFlight = new Map();
  const pendingById = new Map();
  const laneQueues = {
    fast: [],
    slow: []
  };
  const laneConcurrency = {
    fast: 1,
    slow: 1
  };
  const laneActive = {
    fast: 0,
    slow: 0
  };
  const FAST_TOOL_NAMES = new Set(['index_status', 'config_status']);
  const normalizeId = (value) => (value === null || value === undefined ? null : String(value));
  const progressState = new Map();
  const PROGRESS_THROTTLE_MS = 250;
  const attachToolResultObservability = (result, requestObservability) => (
    result && typeof result === 'object' && !Array.isArray(result) && result.observability
      ? result
      : attachObservability(result, requestObservability)
  );

  const sendProgress = (id, tool, payload, observability = null) => {
    if (id === null || id === undefined) return;
    const message = payload?.message ? String(payload.message) : '';
    if (!message) return;
    const idKey = normalizeId(id);
    const now = Date.now();
    const state = progressState.get(idKey) || { lastSent: 0, timer: null, pending: null };
    const emit = (nextPayload) => {
      const nextMessage = nextPayload?.message ? String(nextPayload.message) : '';
      if (!nextMessage) return;
      sendNotification('notifications/progress', {
        id,
        tool,
        message: nextMessage,
        stream: nextPayload?.stream || 'info',
        phase: nextPayload?.phase || 'progress',
        ts: new Date().toISOString(),
        observability: nextPayload?.observability || observability || null
      });
      state.lastSent = Date.now();
      state.pending = null;
    };
    if (!state.lastSent || (now - state.lastSent) >= PROGRESS_THROTTLE_MS) {
      emit(payload);
      progressState.set(idKey, state);
      return;
    }
    state.pending = payload;
    if (!state.timer) {
      const delay = Math.max(0, PROGRESS_THROTTLE_MS - (now - state.lastSent));
      state.timer = setTimeout(() => {
        state.timer = null;
        if (state.pending) {
          emit(state.pending);
        }
      }, delay);
      state.timer.unref?.();
    }
    progressState.set(idKey, state);
  };

  const clearProgressState = (idKey) => {
    const state = progressState.get(idKey);
    if (state?.timer) clearTimeout(state.timer);
    progressState.delete(idKey);
  };

  const sendCancelledResponse = (id) => {
    const payload = formatToolError({ code: ERROR_CODES.CANCELLED, message: 'Request cancelled.' });
    sendResult(id, {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      isError: true
    });
  };

  const totalQueued = () => laneQueues.fast.length + laneQueues.slow.length;
  const totalActive = () => laneActive.fast + laneActive.slow;
  const classifyToolLane = (name, timeoutMs) => {
    if (FAST_TOOL_NAMES.has(String(name || '').trim())) return 'fast';
    if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 && Number(timeoutMs) <= 5000) {
      return 'fast';
    }
    return 'slow';
  };

  const removePendingTask = (idKey) => {
    if (!pendingById.has(idKey)) return null;
    const task = pendingById.get(idKey);
    pendingById.delete(idKey);
    const queue = laneQueues[task?.lane] || [];
    const index = queue.findIndex((entry) => entry.idKey === idKey);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    return task || null;
  };

  const applyCancellation = (params) => {
    const cancelKey = normalizeId(params?.id);
    if (cancelKey === null) return false;
    const entry = inFlight.get(cancelKey);
    if (entry) {
      entry.cancelled = true;
      entry.controller.abort();
      return true;
    }
    const pendingTask = removePendingTask(cancelKey);
    if (pendingTask) {
      clearProgressState(cancelKey);
      sendCancelledResponse(pendingTask.id);
      return true;
    }
    return false;
  };

  const processTask = async (task) => {
    const {
      id,
      idKey,
      lane,
      name,
      args,
      timeoutMs
    } = task;
    const controller = new AbortController();
    const requestObservability = normalizeObservability({
      correlationId: task.meta?.correlationId || null,
      parentCorrelationId: task.meta?.parentCorrelationId || null,
      requestId: task.meta?.requestId || idKey
    }, {
      surface: 'mcp',
      operation: name,
      context: {
        tool: name,
        toolCallId: idKey,
        qosLane: lane
      }
    });
    const entry = { controller, cancelled: false, observability: requestObservability, lane };
    inFlight.set(idKey, entry);
    let timedOut = false;
    const progress = (payload) => {
      if (timedOut) return;
      sendProgress(id, name, payload, requestObservability);
    };
    try {
      const result = await withTimeout(
        handleToolCall(name, args, {
          progress,
          toolCallId: id,
          signal: controller.signal,
          observability: requestObservability
        }),
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
        content: [{ type: 'text', text: JSON.stringify(attachToolResultObservability(result, requestObservability), null, 2) }]
      });
    } catch (error) {
      const activeEntry = inFlight.get(idKey);
      if (activeEntry?.cancelled && error?.code !== ERROR_CODES.TOOL_TIMEOUT) {
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
      inFlight.delete(idKey);
      clearProgressState(idKey);
    }
  };

  const scheduleWork = () => {
    while (totalActive() < (laneConcurrency.fast + laneConcurrency.slow)) {
      let lane = null;
      if (laneActive.fast < laneConcurrency.fast && laneQueues.fast.length > 0) {
        lane = 'fast';
      } else if (laneActive.slow < laneConcurrency.slow && laneQueues.slow.length > 0) {
        lane = 'slow';
      } else {
        break;
      }
      const task = laneQueues[lane].shift();
      if (!task) continue;
      pendingById.delete(task.idKey);
      laneActive[lane] += 1;
      void processTask(task)
        .catch((error) => {
          logError('[mcp] queue error', { error: error?.message || String(error), lane });
        })
        .finally(() => {
          laneActive[lane] = Math.max(0, laneActive[lane] - 1);
          scheduleWork();
        });
    }
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
        capabilities,
        capabilityManifest
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
      const idKey = normalizeId(id);
      const name = params?.name;
      const args = params?.arguments || {};
      const timeoutMs = resolveToolTimeoutMs(name, args);
      const lane = classifyToolLane(name, timeoutMs);
      if (Number.isFinite(queueMax) && queueMax > 0 && (totalQueued() + totalActive()) >= queueMax) {
        sendError(id, -32001, 'Server overloaded.', undefined, { code: ERROR_CODES.QUEUE_OVERLOADED });
        return;
      }
      const task = {
        id,
        idKey,
        lane,
        name,
        args,
        timeoutMs,
        meta: params?._meta || null
      };
      pendingById.set(idKey, task);
      laneQueues[lane].push(task);
      scheduleWork();
      return;
    }

    if (id !== null && id !== undefined) {
      sendError(id, -32601, `Method not found: ${method}`, undefined, { code: ERROR_CODES.NOT_FOUND });
    }
  }

  function enqueueMessage(message) {
    if (message?.method === '$/cancelRequest') {
      applyCancellation(message.params);
      return;
    }
    void handleMessage(message).catch((error) => {
      logError('[mcp] queue error', { error: error?.message || String(error) });
    });
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
