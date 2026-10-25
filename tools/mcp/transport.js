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
import { logError } from '../../src/shared/progress-runtime.js';
import { withTimeout } from './runner.js';

// Match the SDK request-ID domain without importing its full schema graph into
// the legacy transport. A key identifies the typed primitive, not its label.
const requestIdKey = value => typeof value === 'string' ? `s:${value}`
  : Number.isSafeInteger(value) ? `n:${value}` : null;

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
  const activeTasks = new Set();
  let closing = false, closePromise = null;
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
    const idKey = requestIdKey(id);
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
  const laneOccupancy = (lane) => (
    (laneQueues[lane]?.length || 0) + (laneActive[lane] || 0)
  );
  const reservedFastCapacity = Number.isFinite(queueMax) && queueMax > 1 ? 1 : 0;
  const slowLaneAdmissionLimit = Number.isFinite(queueMax) && queueMax > 0
    ? Math.max(1, queueMax - reservedFastCapacity)
    : Infinity;
  const classifyToolLane = (name, timeoutMs) => {
    if (FAST_TOOL_NAMES.has(String(name || '').trim())) return 'fast';
    if (Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 && Number(timeoutMs) <= 5000) {
      return 'fast';
    }
    return 'slow';
  };
  const resolveOverloadDecision = (lane) => {
    if (!Number.isFinite(queueMax) || queueMax <= 0) {
      return { overloaded: false, reason: null };
    }
    const activeAndQueued = totalQueued() + totalActive();
    if (lane === 'slow' && reservedFastCapacity > 0 && laneOccupancy('slow') >= slowLaneAdmissionLimit) {
      return {
        overloaded: true,
        reason: 'fast-lane-reserved-capacity'
      };
    }
    if (activeAndQueued >= queueMax) {
      return {
        overloaded: true,
        reason: 'queue-max-capacity'
      };
    }
    return { overloaded: false, reason: null };
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

  const resolveActiveRequestState = (idKey) => {
    const pending = pendingById.has(idKey);
    const running = inFlight.has(idKey);
    if (pending && running) return 'pending-and-running';
    if (running) return 'running';
    if (pending) return 'pending';
    return null;
  };

  const rejectDuplicateRequestId = (id, idKey) => {
    const state = resolveActiveRequestState(idKey);
    if (!state) return false;
    sendError(id, -32600, 'Duplicate request id while prior request is still pending or running.', undefined, {
      code: ERROR_CODES.INVALID_REQUEST,
      reason: 'duplicate-request-id',
      requestId: id,
      state
    });
    return true;
  };

  const applyCancellation = (params) => {
    const cancelKey = requestIdKey(params?.id);
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
    if (rejectDuplicateRequestId(id, idKey)) return;
    const controller = new AbortController();
    const requestObservability = normalizeObservability({
      correlationId: task.meta?.correlationId || null,
      parentCorrelationId: task.meta?.parentCorrelationId || null,
      requestId: task.meta?.requestId || String(id)
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
    let execution = null;
    const progress = (payload) => {
      if (timedOut) return;
      sendProgress(id, name, payload, requestObservability);
    };
    try {
      execution = Promise.resolve().then(() => handleToolCall(name, args, {
        progress,
        toolCallId: id,
        signal: controller.signal,
        observability: requestObservability
      }));
      const result = await withTimeout(
        execution,
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
      // The timeout response is prompt, but capacity and request identity stay
      // owned until the aborted operation and its children actually settle.
      await execution?.catch(() => {});
      inFlight.delete(idKey);
      clearProgressState(idKey);
    }
  };

  const scheduleWork = () => {
    if (closing) return;
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
      const executionTask = processTask(task)
        .catch((error) => {
          logError('[mcp] queue error', { error: error?.message || String(error), lane });
        })
        .finally(() => {
          laneActive[lane] = Math.max(0, laneActive[lane] - 1);
          activeTasks.delete(executionTask);
          scheduleWork();
        });
      activeTasks.add(executionTask);
    }
  };

  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    for (const [idKey, task] of pendingById) {
      removePendingTask(idKey);
      clearProgressState(idKey);
      sendCancelledResponse(task.id);
    }
    for (const entry of inFlight.values()) {
      entry.cancelled = true;
      entry.controller.abort();
    }
    closePromise = Promise.allSettled(Array.from(activeTasks)).then(() => {});
    return closePromise;
  };

  /**
   * Handle a JSON-RPC message from stdin.
   * @param {object} message
   * @returns {Promise<void>}
   */
  async function handleMessage(message) {
    if (!message || message.jsonrpc !== '2.0') return;
    const { id, method, params } = message;
    if (Object.hasOwn(message, 'id') && requestIdKey(id) === null) {
      sendError(null, -32600, 'Request id must be a string or safe integer.', undefined,
        { code: ERROR_CODES.INVALID_REQUEST, reason: 'invalid-request-id' });
      return;
    }

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
      await close();
      sendResult(id, {});
      return;
    }

    if (method === 'exit') {
      await close();
      closeOutput();
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
      if (closing) { sendCancelledResponse(id); return; }
      const idKey = requestIdKey(id);
      if (rejectDuplicateRequestId(id, idKey)) return;
      const name = params?.name;
      const args = params?.arguments || {};
      const timeoutMs = resolveToolTimeoutMs(name, args);
      const lane = classifyToolLane(name, timeoutMs);
      const overloadDecision = resolveOverloadDecision(lane);
      if (overloadDecision.overloaded) {
        sendError(id, -32001, 'Server overloaded.', undefined, {
          code: ERROR_CODES.QUEUE_OVERLOADED,
          lane,
          reason: overloadDecision.reason
        });
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
    void handleMessage(message).catch((error) => {
      logError('[mcp] queue error', { error: error?.message || String(error) });
    });
  }

  const start = () => {
    const parser = createFramedJsonRpcParser({
      onMessage: enqueueMessage,
      onError: (err) => {
        logError('[mcp] stream error', { error: err?.message || String(err) });
        void close().finally(() => { closeOutput(); process.exit(1); });
      },
      maxBufferBytes
    });
    process.stdin.on('data', (chunk) => parser.push(chunk));
    process.stdin.on('end', () => {
      void close().finally(() => { closeOutput(); process.exit(0); });
    });
    process.stdin.on('error', (err) => {
      logError('[mcp] stream error', { error: err?.message || String(err) });
      void close().finally(() => { closeOutput(); process.exit(1); });
    });
    return parser;
  };

  return { start, close };
};
